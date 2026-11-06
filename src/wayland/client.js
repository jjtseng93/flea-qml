// A windowless Wayland client: the display, the registry and round trips, nothing to draw.
// Adapted from buninu-browser frontends/wayland/client.js (MIT, Dr. John), without the
// compositor, shm and xdg_wm_base binds a window needs; the clipboard binds what it uses.
import { discoverSocket } from "./socket-discovery.js";
import { connectUnix } from "./transport.js";
import { interfaces, decode, encodeRequest } from "./protocol.js";

export class WaylandClient {
  constructor(path) {
    this.socketPath = path;
    this.objects = new Map();
    this.nextId = 2;
    this.globals = new Map();
    this.waiters = new Set();
    this.closed = false;
    this.objects.set(1, {
      iface: "wl_display",
      event: (name, args) => {
        if (name === "error") throw Error(`Wayland error ${args.join(": ")}`);
        if (name === "delete_id") this.objects.delete(args[0]);
      },
    });
  }
  object(iface, event = () => {}) {
    const id = this.nextId++;
    this.objects.set(id, { iface, event });
    return id;
  }
  request(id, name, ...args) {
    const object = this.objects.get(id);
    if (!object) throw Error(`Unknown object ${id}`);
    const packet = encodeRequest(id, object.iface, name, args);
    this.connection.send(packet.data, packet.fds);
    this.connection.flush();
  }
  receive() {
    const c = this.connection;
    while (!c.closed && c.input.length >= 8) {
      const id = c.input.readUInt32LE(0),
        header = c.input.readUInt32LE(4),
        size = header >>> 16,
        opcode = header & 65535;
      if (size < 8 || size % 4) throw Error("Invalid event size");
      if (c.input.length < size) return;
      const object = this.objects.get(id),
        spec = interfaces.get(object?.iface)?.events[opcode];
      if (!spec) throw Error(`Unknown event ${id}:${opcode}`);
      const args = decode(spec, c.input.subarray(0, size), c.fds);
      if (args === null) return;
      c.input = c.input.subarray(size);
      object.event(spec.name, args);
    }
  }
  sync() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(fail);
        reject(Error("Wayland roundtrip timeout"));
      }, 5000);
      const fail = (e) => {
        clearTimeout(timer);
        reject(e);
      };
      this.waiters.add(fail);
      const id = this.object("wl_callback", () => {
        clearTimeout(timer);
        this.waiters.delete(fail);
        resolve();
      });
      this.request(1, "sync", id);
    });
  }
  async initialize() {
    this.connection = await discoverSocket(connectUnix, this.socketPath);
    if (this.closed) {
      this.connection.close();
      throw Error("Wayland client closed");
    }
    this.connection.onData = () => this.receive();
    this.connection.onClose = () => {
      clearInterval(this.timer);
      this.closed = true;
      for (const reject of this.waiters) reject(this.connection.error ?? Error("Wayland disconnected"));
      this.waiters.clear();
      this.onClose?.();
    };
    // Polled, as buninu-browser does; unref'd so the connection alone never keeps the backend alive.
    this.timer = setInterval(() => this.connection.poll(), 8);
    this.timer.unref?.();
    this.registry = this.object("wl_registry", (event, [name, iface, version]) => {
      if (event === "global") this.globals.set(iface, { name, version });
      else for (const [key, value] of this.globals) if (value.name === name) this.globals.delete(key);
    });
    this.request(1, "get_registry", this.registry);
    await this.sync();
    return this;
  }
  bind(iface, version, event) {
    const global = this.globals.get(iface);
    if (!global) throw Error(`Compositor lacks ${iface}`);
    const id = this.object(iface, event);
    this.request(this.registry, "bind", global.name, iface, Math.min(version, global.version), id);
    return id;
  }
  close() {
    this.closed = true;
    this.connection?.close();
  }
}
