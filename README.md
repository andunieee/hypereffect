# hypereffect

A small hypermedia protocol for server-driven UI in simple applications. The server sends
newline-delimited, tagged JSON messages (`element`, `remove`, `signal`); a renderer draws a fixed
set of components with native widgets and sends back `action` messages. Attributes can be CEL
expressions over a shared signals object, which is patched with JSON Merge Patch (RFC 7386).

The website lives in `site/` and is plain static HTML with one stylesheet. Open
`site/index.html` in a browser, or serve the directory:

```
python -m http.server -d site
```

Pages:

- `index.html` — overview
- `concepts.html` — hypermedia, elements and signals, CEL, variants
- `guide.html` — worked examples, writing servers and renderers
- `components.html` — component reference
- `spec.html` — normative specification (draft 0.1)
