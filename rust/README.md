# hypereffect (Rust)

`hypereffect/` is a library crate with types and helpers for both ends of the
protocol. `demos/` holds three servers that the site's `/demo` page runs as
WebAssembly.

## Servers

```rust
use hypereffect::ui::*;
use hypereffect::{cel, json, Action, App, Handler, Map, Outbox, Value};

#[derive(Default)]
struct Counter { count: i64 }

impl App for Counter {
    fn hello(&mut self, out: &mut Outbox, _signals: &Map<String, Value>) {
        out.signal(json!({ "count": 0 }));
        out.element(column("main"));
        out.element(text("value").parent("main").text(cel("'Count: ' + string(signals.count)")));
        out.element(button("inc").parent("main").label("+").on_press(Handler::action("add")));
    }

    fn action(&mut self, out: &mut Outbox, action: &Action) {
        if action.name == "add" {
            self.count += 1;
            out.signal(json!({ "count": self.count }));
        }
    }
}
```

- `Element`, `Handler`, `ServerMessage` and `RendererMessage` serialize to and
  parse from lines; `LineBuffer` splits a byte stream into lines.
- `signals` has merge patch, local-signal stripping and signal paths.
- `Server<A>` drives an `App` from the bytes a renderer sends, creating a new
  app on every hello.
- `hypereffect::wasm_app!(Counter)` exports the app from a module for
  `wasm32-unknown-unknown` that imports nothing. The host writes renderer
  bytes with `he_buffer`/`he_receive`, reads output with
  `he_output`/`he_output_len`/`he_output_clear`, and calls `he_tick` at the
  interval `he_tick_interval` returns. See `site/demo/transport.js` for a host.

## Renderers

With the `client` feature, `client::Client` is the renderer side without
drawing, on top of the [`cel`](https://crates.io/crates/cel) crate:

```rust
let mut c = hypereffect::client::Client::new();
let hello = c.hello(Default::default()); // send this line
c.receive(bytes_from_server);
let el = c.get("value").unwrap();        // attrs resolved to plain JSON
let action = c.trigger("inc", "onPress"); // Some(line) to send
let changes = c.take_changes();          // what to redraw
```

`server::Loopback` connects a `Client` to a `Server` in one process, which is
how the demos are tested (`demos/*/tests`).

## Building and testing

```
cargo test --all-features
../scripts/build-demo.sh   # builds the demos to wasm and copies them into ../site/demo
```
