// jsgotty appends the requested tab directory as one argv entry, never shell text.
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {join, isAbsolute} from 'node:path';
export function shellCommand(which = Bun.which, exists = existsSync, platform = process.platform) {
  const sibling = join(import.meta.dir, '../../bunmsh/index.js');
  if (exists(sibling)) return [which('bun') || process.execPath, sibling];
  const bunmsh = which('bunmsh');
  if (bunmsh) return [bunmsh];
  if (platform !== 'win32') return ['/bin/sh'];
  for (const name of ['powershell', 'pwsh']) {
    const path = which(name);
    if (path) return [path];
  }
  throw Error('No shell was found on PATH. Install bunmsh, PowerShell or pwsh.');
}
if (import.meta.main) {
  const cwd = process.argv[2];
  if (!cwd || !isAbsolute(cwd)) throw Error('An absolute terminal directory is required');
  process.chdir(cwd);
  const command = shellCommand();
  const child = spawn(command[0], command.slice(1), {stdio:'inherit', windowsHide:true});
  for (const signal of ['SIGTERM','SIGINT','SIGHUP']) process.on(signal, () => child.kill(signal));
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
  child.on('exit', code => process.exit(code || 0));
}
