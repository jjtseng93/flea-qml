// A shared, loopback-only server. Each tab owns a reconnect token, not a server.
// stdin is the GUI's lifetime lease; EOF also closes all PTYs after a GUI crash.
import {existsSync} from 'node:fs';
import {resolve, join, isAbsolute} from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
export const RANDOM_URL_LENGTH = 48;
export function terminalCommand(which = Bun.which, exists = existsSync, repo = resolve(import.meta.dir, '..')) {
  const sibling = join(repo, '..', 'jsgotty', 'gotty.js');
  if (exists(sibling)) return [which('bun') || process.execPath, sibling];
  const executable = which('jsgotty');
  return executable ? [executable] : null;
}
export function terminalArguments() {
  return ['--address','127.0.0.1','--port','0','--permit-write','--random-url',
    '--random-url-length',String(RANDOM_URL_LENGTH),'--session','--permit-arguments',
    '--close-signal','SIGTERM','--close-timeout','1',
    // QtWebEngine's isolated iframe sends Origin:null. No arbitrary site origins.
    '--ws-origin','^(|null|http://127\\.0\\.0\\.1:[0-9]+)$',
    Bun.which('bun') || process.execPath, join(import.meta.dir,'terminal-shell.js')];
}
// Use jsgotty's existing WebTTY session protocol rather than scraping a session list.
export function sessionRequest(base, init, type) {
  return new Promise((resolveRequest,reject) => {
    const ws = new WebSocket(base.replace(/^http/,'ws')+'ws','webtty');
    let done=false;
    const timer=setTimeout(()=>finish(Error('Terminal session request timed out')),15000);
    function finish(error,value){if(done)return;done=true;clearTimeout(timer);ws.close();error?reject(error):resolveRequest(value);}
    ws.onopen=()=>ws.send(JSON.stringify({AuthToken:'',ReadOnly:true,...init}));
    ws.onmessage=event=>{
      const text=String(event.data);
      if(text[0]!==type)return;
      try {const result=JSON.parse(text.slice(1)); if(result.ok===false)throw Error(result.message);finish(null,result);} catch(e){finish(e);}
    };
    ws.onerror=()=>finish(Error('Terminal session connection failed'));
    ws.onclose=()=>finish(Error('Terminal session connection closed'));
  });
}
export async function runTerminalServer() {
  const send=value=>{try{process.stdout.write(JSON.stringify(value)+'\n');}catch{}};
  const command=terminalCommand();
  if(!command){send({error:'jsgotty was not found. Install it on PATH (npm i -g jsgotty).'});return 1;}
  let child,stopping=false,killer,buffer='',base='';
  const tabs=new Map();
  let readyResolve,readyReject;
  const ready=new Promise((res,rej)=>{readyResolve=res;readyReject=rej;});ready.catch(()=>{});
  const stop=()=>{
    if(stopping)return;stopping=true;readyReject(Error('Terminal server stopped'));
    child?.kill('SIGTERM');killer=setTimeout(()=>child?.kill('SIGKILL'),7000);killer.unref();
  };
  const closeSession=async token=>{if(base&&token&&!stopping)await sessionRequest(base,{ReconnectToken:token,TerminateSession:true},'b');};
  const lines=createInterface({input:process.stdin,crlfDelay:Infinity});
  lines.on('line',async line=>{
    let request;
    try {
      request=JSON.parse(line);
      if(request.shutdown===true){stop();return;}
      if(typeof request.id!=='string'||request.id.length>128)throw Error('Invalid terminal tab id');
      if(request.close){const record=tabs.get(request.id);tabs.delete(request.id);if(record)await closeSession(record.token);return;}
      if(typeof request.path!=='string'||!isAbsolute(request.path))throw Error('An absolute terminal directory is required');
      if(tabs.has(request.id))return;
      const record={token:''};tabs.set(request.id,record);
      await ready;
      if(tabs.get(request.id)!==record||stopping)return;
      const args=new URLSearchParams({arg:request.path});
      const session=await sessionRequest(base,{Arguments:'?'+args},'5');
      record.token=session.token;
      if(tabs.get(request.id)!==record||stopping){await closeSession(record.token);return;}
      send({id:request.id,url:base+'?reconnect-token='+encodeURIComponent(record.token),pid:session.pid});
    } catch(error){send({id:request?.id,error:error.message});}
  });
  lines.on('close',stop);process.on('SIGTERM',stop);process.on('SIGINT',stop);
  try {
    child=spawn(command[0],[...command.slice(1),...terminalArguments()],{stdio:['pipe','pipe','pipe'],windowsHide:true});
    const read=chunk=>{
      buffer=(buffer+chunk.toString()).slice(-16384);
      if(base)return;
      const match=buffer.match(/http:\/\/127\.0\.0\.1:(\d+)\/([A-Za-z0-9]{48})\//);
      if(match&&+match[1]>0&&+match[1]<=65535){base=match[0];readyResolve();send({ready:true});}
    };
    child.stdout.on('data',read);child.stderr.on('data',read);
    return await new Promise(resolveExit=>{
      child.on('error',error=>{readyReject(error);send({error:error.message});resolveExit(1);});
      child.on('close',code=>{
        readyReject(Error('Terminal server exited'));
        if(!stopping)send({error:base?'Terminal server exited.':'jsgotty failed to start: '+buffer.slice(-2000)});
        resolveExit(stopping?0:code||1);
      });
    });
  } finally {
    clearTimeout(killer);lines.removeAllListeners();lines.close();process.stdin.pause();
    process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);
  }
}
if(import.meta.main)process.exit(await runTerminalServer());
