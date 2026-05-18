# hypereffect (JavaScript)

The renderer side of a hypereffect session, without any drawing and without
dependencies. `Session` parses lines, keeps the element tree and the signals,
evaluates CEL expressions with its own interpreter, runs handlers, and tells a
UI layer which elements changed. The UI layer maps components to widgets; see
`site/demo/renderer.js` for one that uses HTML.

```js
import { Session } from 'hypereffect';

const ws = new WebSocket(url);
const session = new Session({
  send: (line) => ws.send(line),
  onUpdate: (u) => redraw(u), // {reset, created, updated, removed, reordered, connection}
});
ws.onopen = () => session.start({ device: 'kitchen' }); // sends hello
ws.onmessage = (e) => session.receive(e.data + '\n');
ws.onclose = () => session.close();

// Reading, for drawing:
session.children(null);      // ids at the root
session.get('title');        // {id, type, parent, children, attrs: {text: 'Inbox', variant: 'h1', visible: true, ...}}
session.value('form.email'); // a signal

// User input:
session.write('form.email', 'ada@example.com'); // a bound control changed
session.trigger('save', 'onPress');             // runs the handler; may send an action
```

Attributes in `get()` are resolved: expressions are evaluated, values are
checked against the attribute's type, and missing or failing values take their
defaults, so a UI layer never sees a `{"cel": …}` object.

Updates are batched: all messages received in one task are processed before
`onUpdate` is called once. Each expression is analysed for the signal paths it
reads, and a signal patch only marks the elements whose expressions or bindings
read a path the patch touched.

## CEL

`cel.js` implements the CEL standard definitions (operators, `size`, `has`,
`int`/`uint`/`double`/`string`/`bool`/`bytes`/`type`/`dyn`, `contains`,
`startsWith`, `endsWith`, `matches`), the macros `all`, `exists`,
`exists_one`, `map` and `filter`, and the cel-go strings extension (`charAt`,
`indexOf`, `lastIndexOf`, `lowerAscii`, `upperAscii`, `replace`, `split`,
`substring`, `trim`, `join`, `format`, `reverse`).

Differences from the spec:

- JSON numbers come from `JSON.parse`, so `1.0` and `1e3` in signals are ints
  rather than doubles.
- Timestamps, durations, protobuf messages and optional values are not
  supported.
- `matches` uses JavaScript regular expressions, which agree with RE2 on common
  syntax.

## Tests

```
node --test
```

This runs CEL unit tests and the shared fixtures in `../fixtures`, which the
Rust client also runs.
