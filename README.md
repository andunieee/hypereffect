# hypereffect

A small hypermedia protocol for server-driven UI in simple applications. The server sends
newline-delimited, tagged JSON messages (`element`, `remove`, `signal`); a renderer draws a fixed
set of components with native widgets and sends back `action` messages. Attributes can be CEL
expressions over a shared signals object, which is patched with JSON Merge Patch (RFC 7386).

The repository has:

- `site/` — the website: plain static HTML with one stylesheet, plus the demo.
- `rust/` — a Rust crate with types and helpers for servers and renderers, and
  three demo servers that compile to WebAssembly. See `rust/README.md`.
- `js/` — a dependency-free JavaScript renderer core: framing, signals, a CEL
  interpreter and the element tree. See `js/README.md`.
- `fixtures/` — renderer test scripts that both libraries run.

Open `site/index.html` in a browser, or serve the directory. The demo needs a
build step first (Rust with the `wasm32-unknown-unknown` target):

```
./scripts/build-demo.sh
python -m http.server -d site
```

Pages:

- `index.html` — overview
- `components.html` — component reference
- `expressions.html` — CEL expressions in attributes
- `spec.html` — normative specification
- `demo/` — the Rust demo servers running as WebAssembly, drawn by the JS library
