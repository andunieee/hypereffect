# hypereffect (TypeScript)

Types and helpers for writing [hypereffect](https://hypereffect.dev) servers in
TypeScript, ported from the [Rust crate](https://github.com/hypereffect/hypereffect/tree/master/rust):
elements, handlers and messages with their line framing, signals, the
components and their nesting rules, an `App`/`Server` session driver, and a
renderer client with a loopback for testing apps without a renderer.

```
npm install @hypereffect/server
```

The package ships compiled JavaScript with type declarations, and uses nothing
specific to Node.

## Servers

```ts
import { type Action, type App, cel, Handler, type Outbox, ui } from '@hypereffect/server';

class Counter implements App {
  count = 0;

  hello(out: Outbox) {
    out.signal({ count: 0 });
    out.element(ui.column('main'));
    out.element(ui.text('value').parent('main').text(cel("'Count: ' + string(s.count)")));
    out.element(ui.button('inc').parent('main').label('+').onPress(Handler.action('add')));
  }

  action(out: Outbox, action: Action) {
    if (action.name === 'add') out.signal({ count: ++this.count });
  }
}
```

- `ui.text('id')` and the other constructors return an `Element` with setters
  for every attribute (`label`, `variant`, `disabled`, …, or `set` for any
  other); each takes a literal or `cel('...')`. `bind` sets a signal path, and
  `onPress`, `onChange`, `onSubmit` and `onDismiss` take a `Handler`:
  `Handler.action('save')`, `Handler.patch({...})` or `Handler.open(url)`,
  refined with `withPayload`, `withIndicator`, `withPatch` and `withOpen`.
- `parseServerMessage`, `parseRendererMessage`, `serverMessageLine` and
  `rendererMessageLine` convert to and from lines; `LineBuffer` splits a
  stream of bytes or text into lines.
- `mergePatch`, `stripLocal`, `parsePath` and friends handle signals.
- `Server` drives an `App` from what a renderer sends, creating a new app on
  every hello. An app with `tick` and `tickInterval` gets a timer.

The library does not open connections. Any transport that carries lines
works: pass what arrives to `server.receive`, then send
`server.output.take()`. With a WebSocket (here the `ws` package):

```ts
wss.on('connection', (ws) => {
  const server = new Server(() => new Counter());
  ws.on('message', (data) => {
    server.receive(data.toString() + '\n');
    const out = server.output.take();
    for (const line of out.split('\n')) if (line) ws.send(line);
  });
});
```

## Testing

`@hypereffect/server/client` is the renderer side without drawing, on top of
[cel-js](https://github.com/marcbachmann/cel-js) with the strings, math and
lists extensions (the same CEL setup as the hypereffect JavaScript renderer).
`Loopback` connects it to a `Server` in one process:

```ts
import { Loopback } from '@hypereffect/server/client';

test('counter', () => {
  const l = new Loopback(() => new Counter()); // sends hello
  l.trigger('inc', 'onPress');                 // true if an action was sent
  assert.equal(l.client.attr('value', 'text'), 'Count: 1');
  assert.deepEqual(l.client.takeDiagnostics(), []); // rejected elements or failed expressions
});
```

`l.write(path, value)` writes a bound signal as a control does,
`l.tick(nowMs)` runs the timer, `l.client.value(path)` reads a signal and
`l.client.takeOpens()` returns the URLs buttons asked to open.
`examples/todos.ts` is the task list demo; `test/todos.test.ts` tests it.

Differences from the Rust crate, all from JavaScript numbers and cel-js:

- JSON numbers come from `JSON.parse`, so `1.0` in signals is an int rather
  than a double.
- cel-js type-checks literals, so `1 == 1.0` is an error; values read from
  signals compare across numeric types by value.
- `matches` uses JavaScript regular expressions.
- There is no WebAssembly export like the Rust `wasm_app!`.

## Tests

```
npm test        # node --test on the TypeScript sources (Node 22.18 or later)
npm run check   # tsc --noEmit
npm run build   # dist/
```

The tests include the shared renderer fixtures in `fixtures/`, copied from the
[hypereffect repository](https://github.com/hypereffect/hypereffect/tree/master/fixtures).
`src/cel.ts` is a port of that repository's `js/src/cel.js`. Copy both again
when they change there.
