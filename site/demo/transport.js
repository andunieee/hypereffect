// Runs a hypereffect server compiled to WebAssembly (see the wasm_app! macro
// in the Rust crate) and acts as the transport between it and a renderer:
// a byte stream of lines in both directions.

const enc = new TextEncoder();
const dec = new TextDecoder();

export class WasmServer {
  static async load(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
    const { instance } = await WebAssembly.instantiate(await res.arrayBuffer(), {});
    return new WasmServer(instance.exports);
  }

  constructor(exports) {
    this.x = exports;
    this.timer = null;
    this.interval = -1;
    this.onData = () => {};
  }

  // Bytes from the renderer.
  write(text) {
    const bytes = enc.encode(text);
    const ptr = this.x.he_buffer(bytes.length);
    new Uint8Array(this.x.memory.buffer, ptr, bytes.length).set(bytes);
    this.x.he_receive(bytes.length);
    this.drain();
  }

  close() {
    this.x.he_close();
    this.drain();
  }

  drain() {
    const len = this.x.he_output_len();
    if (len) {
      const text = dec.decode(new Uint8Array(this.x.memory.buffer, this.x.he_output(), len));
      this.x.he_output_clear();
      this.onData(text);
    }
    this.schedule();
  }

  // Runs the app's timer at the interval it asks for.
  schedule() {
    const want = this.x.he_tick_interval();
    if (want === this.interval) return;
    clearInterval(this.timer);
    this.interval = want;
    this.timer = want >= 0
      ? setInterval(() => { this.x.he_tick(performance.now()); this.drain(); }, want)
      : null;
  }
}

// A pipe that delivers chunks in order after a delay, to imitate a network.
export class Delay {
  constructor(deliver) {
    this.deliver = deliver;
    this.ms = 0;
    this.last = 0;
    this.closed = false;
  }

  push(chunk) {
    if (this.closed) return;
    const now = performance.now();
    if (this.ms <= 0 && this.last <= now) {
      this.deliver(chunk);
      return;
    }
    const at = Math.max(now + this.ms, this.last);
    this.last = at;
    setTimeout(() => { if (!this.closed) this.deliver(chunk); }, at - now);
  }

  // Drops anything still in flight.
  close() {
    this.closed = true;
  }
}
