#!/usr/bin/env bun
import {fileURLToPath, pathToFileURL} from 'node:url';
import {resolve, dirname} from 'node:path';
import info from './package.json' with {type:'json'};

export const entryURL = pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), 'ui/boot/shell.qml')).href;
const hasFrontend = args => args[0]?.startsWith('--') && args[0] !== '--';

// Read the package specification only; never execute the script through a shell.
export function browserPackage(script = info.scripts.browser) {
  const match = /^bunx\s+(buninu-browser@[^\s;&|<>`$]+)\s*$/.exec(script ?? '');
  if (!match) throw new Error('scripts.browser must be "bunx buninu-browser@VERSION"');
  return match[1];
}

// Match buninu-browser's Casty launcher: npx needs Bun for the bin shebang.
export function browserCommand(args, which = Bun.which, runtime = process.argv0) {
  const pkg = browserPackage();
  const npx = which('npx'), bun = which('bun');
  if (npx && bun) return [npx, '--loglevel=error', '-p', pkg, '--', 'buninu-browser', ...args];
  const bunx = which('bunx');
  return bunx ? [bunx, pkg, ...args] : [bun ?? runtime, 'x', pkg, ...args];
}

export function selectFrontend(args, kitty, platform = process.platform) {
  if (hasFrontend(args)) {
    const [first, ...rest] = args;
    return {frontend:first, args:rest};
  }
  return {frontend:kitty ? '--casty' : platform === 'win32' ? '--win32' : '--wayland', args};
}

// An actual inline graphics query, not a TERM-name guess. Restore stdin before
// launching the child, and preserve input unrelated to the query response.
export async function detectKitty(input = process.stdin, output = process.stdout, timeout = 800) {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function') return false;
  const id = 100000 + Math.floor(Math.random()*1000000000);
  const marker = Buffer.from(`\x1b_Gi=${id};`), end = Buffer.from('\x1b\\');
  const wasRaw = input.isRaw, wasPaused = input.isPaused();
  let bytes = Buffer.alloc(0), timer, onData, onError, onSignal;
  try {
    input.setRawMode(true);
    return await new Promise((resolve, reject) => {
      const finish = value => {clearTimeout(timer); resolve(value);};
      onError = error => {clearTimeout(timer); reject(error);};
      onSignal = () => onError(new Error('Interrupted during terminal detection'));
      onData = chunk => {
        bytes = Buffer.concat([bytes, Buffer.from(chunk)]);
        const start = bytes.indexOf(marker);
        const stop = start < 0 ? -1 : bytes.indexOf(end, start + marker.length);
        if (stop < 0) {if (bytes.length > 65536) finish(false);return;}
        const reply = bytes.subarray(start + marker.length, stop).toString();
        bytes = Buffer.concat([bytes.subarray(0,start), bytes.subarray(stop+end.length)]);
        finish(reply === 'OK' || reply.startsWith('OK '));
      };
      input.on('data', onData); input.on('error', onError); output.on('error', onError);
      for (const signal of ['SIGINT','SIGTERM','SIGHUP']) process.on(signal,onSignal);
      timer = setTimeout(() => finish(false), timeout);
      input.resume();
      output.write(`\x1b_Ga=q,t=d,f=24,s=1,v=1,i=${id},q=0;AAAA\x1b\\`);
    });
  } finally {
    clearTimeout(timer);input.pause();
    if (onData) input.off('data',onData);
    if (onError) {input.off('error',onError);output.off('error',onError);}
    if (onSignal) for (const signal of ['SIGINT','SIGTERM','SIGHUP']) process.off(signal,onSignal);
    input.setRawMode(!!wasRaw);
    if (bytes.length) input.unshift(bytes);
    if (!wasPaused) input.resume();
  }
}

export async function main(args = Bun.argv.slice(2)) {
  if (args[0] === '--readme') {
    process.stdout.write(Bun.markdown.ansi(await Bun.file(new URL('./README.md', import.meta.url)).text(), {hyperlinks:true}));
    return 0;
  }
  if (['-h','--help'].includes(args[0])) {
    console.log(`Usage: flea-qml [BROWSER_FRONTEND] [BROWSER_ARGS...]\n\nAutomatically probes Kitty graphics; otherwise Windows uses --win32,\nother platforms (including Linux/Android) use --wayland. The first argument\nis passed unchanged to buninu-browser and overrides detection (for example
--casty, --win32, --wayland or --headless). Requires Bun on PATH. Remaining arguments go unchanged\nto buninu-browser after the absolute file URL of ui/boot/shell.qml.\n\n  --readme       Print the README as coloured ANSI Markdown\n  --version, -V  Print the package version\n  --help, -h     Show this help`);
    return 0;
  }
  if (['-V','--version'].includes(args[0])) {console.log(`flea-qml ${info.version}\n${browserPackage()} (pinned)`);return 0;}
  let kitty = false;
  if (!hasFrontend(args)) {
    try {kitty = await detectKitty();}
    finally {
      // The child inherits the terminal. The probe must neither consume its
      // input nor keep this launcher alive after the child has exited.
      process.stdin.pause();
      process.stdin.unref?.();
    }
  }
  const selection = selectFrontend(args, kitty);
  const browserArgs = [selection.frontend, entryURL, ...selection.args];
  const child = Bun.spawn({cmd:browserCommand(browserArgs),stdio:['inherit','inherit','inherit']});
  const handlers = ['SIGINT','SIGTERM','SIGHUP'].map(signal => {
    const handler = () => {try {child.kill(signal);} catch {}};
    process.on(signal,handler);return [signal,handler];
  });
  try {return (await child.exited) ?? 1;}
  finally {for(const [signal,handler] of handlers) process.off(signal,handler);}
}
if (import.meta.main) {
  try {process.exitCode = await main();}
  catch (error) {console.error('flea-qml: '+error.message);process.exitCode=1;}
}
