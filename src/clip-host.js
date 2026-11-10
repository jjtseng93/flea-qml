// No Wayland: ask the QML frontend to use Quickshell's clipboard, never spawn
// a second platform clipboard implementation in the file-manager backend.
let nextId = 0;
const pending = new Map();
const LIMIT = 8 * 1024 * 1024;

export function clipHostReply(message) {
  const entry = pending.get(message.id);
  if (!entry) return;
  pending.delete(message.id);
  clearTimeout(entry.timer);
  if (!message.ok) entry.reject(Error(String(message.error || 'Quickshell clipboard failed')));
  else if (typeof message.text === 'string' && Buffer.byteLength(message.text) > LIMIT)
    entry.reject(Error('Clipboard text exceeds limit'));
  else entry.resolve(message);
}

export class HostClipboard {
  constructor(send, { clipText, parseClipText, none }) {
    Object.assign(this, { send, clipText, parseClipText, none });
    this.hostText = true;
    this.owned = null;
    this.queue = Promise.resolve();
  }
  ordered(fn) {
    const result = this.queue.then(fn);
    this.queue = result.catch(() => {});
    return result;
  }
  request(op, text) {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Error('Quickshell clipboard reply timed out'));
      }, 15000);
      timer.unref?.();
      pending.set(id, { resolve, reject, timer });
      try { this.send({ t: 'clipHost', id, op, ...(text === undefined ? {} : { text }) }); }
      catch (e) { clearTimeout(timer); pending.delete(id); reject(e); }
    });
  }
  set(_payloads, owned) {
    return this.ordered(async () => {
      const text = owned.op === 'text' ? owned.paths[0] : this.clipText(owned.op, owned.paths);
      await this.request('write', text);
      this.owned = { ...owned, text };
    });
  }
  snapshot() {
    return this.ordered(async () => {
      const answer = await this.request('read');
      if (typeof answer.text !== 'string') throw Error('Invalid Quickshell clipboard reply');
      const clip = this.parseClipText(answer.text);
      if (!clip) return this.none;
      return { clip: clip.op, paths: clip.paths, skipped: 0,
        token: this.owned?.text === answer.text ? this.owned.token : '' };
    });
  }
  clearIf(request) {
    return this.ordered(async () => {
      let text;
      if (typeof request.token === 'string' && request.token) {
        if (this.owned?.token !== request.token) return false;
        text = this.owned.text;
      } else if (Array.isArray(request.cut) && request.cut.length
        && request.cut.every(p => typeof p === 'string')) text = this.clipText('cut', request.cut);
      else return false;
      // Compare and clear in the frontend's ordered queue. Sources may already
      // have moved; checking their existence here would leave a spent cut alive.
      const answer = await this.request('clear', text);
      if (answer.cleared) this.owned = null;
      return answer.cleared === true;
    });
  }
}
