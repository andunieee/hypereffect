# hypereffect (JavaScript)

The renderer side of a hypereffect session, without any drawing. `Session`
parses lines, keeps the element tree and the signals, evaluates CEL
expressions with [@marcbachmann/cel-js](https://www.npmjs.com/package/@marcbachmann/cel-js),
runs handlers, and tells a UI layer which elements changed. The UI layer maps
components to widgets; see `site/demo/renderer.js` for one that uses HTML.

```js
import { Session } from 'hypereffect';

const ws = new WebSocket(url);
const session = new Session({
  send: (line) => ws.send(line),
  onUpdate: (u) => redraw(u), // {reset, created, updated, removed, reordered, connection}
});
ws.onopen = () => session.start(); // sends hello
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

`cel.js` sets up a cel-js environment with the variable `s` (the signals), and
registers what cel-js lacks from the functions the spec requires: `charAt`,
`replace`, `reverse`, `format` and `strings.quote` from the cel-go strings
extension, and the math and lists extensions (`lists.first` and `lists.last`
excepted, as in the spec).

In a browser, map the bare `@marcbachmann/cel-js` import with an import map,
as the site does:

```html
<script type="importmap">
{ "imports": { "@marcbachmann/cel-js": "https://cdn.jsdelivr.net/npm/@marcbachmann/cel-js@8.0.0/+esm" } }
</script>
```

Differences from the spec:

- JSON numbers come from `JSON.parse`, so `1.0` and `1e3` in signals are ints
  rather than doubles.
- cel-js type-checks literals, as cel-go does, so `1 == 1.0` is an error;
  values read from signals compare across numeric types by value.
- Lists cannot be indexed with a `uint`, `int()` of a huge double does not
  fail, and `matches` uses JavaScript regular expressions, which agree with
  RE2 on common syntax but not on inline flags such as `(?i)`.

## Tests

```
node --test
```

This runs CEL unit tests and the shared fixtures in `../fixtures`, which the
Rust client also runs.
