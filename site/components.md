# hypereffect components

> The complete list of the eighteen hypereffect components and their
> attributes, for language models writing servers. Normative source:
> [components.html](https://hypereffect.dev/components.html), part of the
> [spec](https://hypereffect.dev/spec.html). For how to send and update
> elements, see [server-guide.md](https://hypereffect.dev/server-guide.md).

The set is fixed: every renderer implements all eighteen, and servers cannot
add more. An element with an unknown `type` is rejected. Unknown attributes are
ignored. Unknown enum values are treated as the attribute's default.

## Conventions

- **Literal** means the value must be plain JSON. **Expression** means the
  value may also be `{"cel":"..."}`, evaluated against the signals `s`.
- Structural attributes are always literal: `id`, `type`, `parent`,
  `before`, `bind` and every handler (`onPress`, `onChange`, `onSubmit`,
  `onDismiss`).
- If an expression fails, or gives the wrong type, the attribute takes its
  default. String and enum attributes need a CEL string (no implicit
  conversion: `string(s.n)`), bool attributes need a bool, number attributes
  accept int, uint or double.
- Variants are semantic, never visual: the renderer decides colours, sizes
  and spacing.
- In Rust, `hypereffect::ui::<component>("id")` creates an element, for
  example `ui::button("save")`. Setters exist for `visible disabled gap
  align justify wrap title empty label open value variant src alt placeholder
  error options min max step text`, plus `.bind(path)`, `.on_press(h)`,
  `.on_change(h)`, `.on_submit(h)`, `.on_dismiss(h)`, `.parent(id)` and
  `.before(id)`. Any other attribute: `.set("name", value)`.

## Attributes every element has

| Attribute | Type | Default | Notes |
| --- | --- | --- | --- |
| `id` | string | — | Required, non-empty. Unique across the whole session (not per parent). Literal. |
| `type` | string | — | Required. The component name. Literal. |
| `parent` | string | root | Id of the containing element, which must already exist. Literal. Must be a `column`, `row`, `card`, `list`, `tab` or `dialog`; a `tab` needs a `tabs`, and a `dialog` cannot have a parent. |
| `before` | string | last | Id of a sibling to insert before. Omitted: append (new elements) or keep the current position (updates). Literal. |
| `visible` | bool | `true` | Expression. When false, the element and its descendants are not shown and take no space, and their handlers do not run. |

Controls (`button`, `input`, `checkbox`, `select`, `slider`) also have:

| Attribute | Type | Default | Notes |
| --- | --- | --- | --- |
| `disabled` | bool | `false` | Expression. Shown but cannot be operated, and does not run handlers. |

The tables below list only the attributes beyond these.

## Nesting

| Parent | Accepts |
| --- | --- |
| root (no `parent`) | anything except `tab` |
| `column`, `row`, `card`, `list`, `tab`, `dialog` | anything except `tab` and `dialog` |
| `tabs` | only `tab` |
| `text`, `notice`, `badge`, `image`, `divider`, `progress`, `button`, `input`, `checkbox`, `select`, `slider` | nothing (leaves) |

A `dialog` always lives at the root and is drawn as an overlay. The root lays
out its children as a `column` with default attributes.

## Containers

### `column`

Arranges children vertically.

| Attribute | Type | Default | Notes |
| --- | --- | --- | --- |
| `gap` | enum | `medium` | Expression. `none` · `small` · `medium` · `large`. |
| `align` | enum | `stretch` | Expression. `start` · `center` · `end` · `stretch`. Horizontal alignment of children. |

```
element {"id":"col","type":"column","gap":"small"}
```

### `row`

Arranges children horizontally. On narrow surfaces a renderer may wrap a row
even when `wrap` is false, rather than overflow.

| Attribute | Type | Default | Notes |
| --- | --- | --- | --- |
| `gap` | enum | `small` | Expression. `none` · `small` · `medium` · `large`. |
| `align` | enum | `center` | Expression. `start` · `center` · `end` · `stretch`. Vertical alignment of children. |
| `justify` | enum | `start` | Expression. `start` · `center` · `end` · `between`. |
| `wrap` | bool | `false` | Expression. |

```
element {"id":"actions","type":"row","justify":"end"}
```

### `card`

A visually grouped region, laid out as a column, typically drawn with a
border or a distinct background.

| Attribute | Type | Default | Notes |
| --- | --- | --- | --- |
| `title` | string | none | Expression. Shown as a heading for the group. |
| `gap` | enum | `medium` | Expression. `none` · `small` · `medium` · `large`. |

```
element {"id":"profile","type":"card","title":"Profile"}
```

### `list`

A vertical sequence of items with separators. Each child is one item.
Renderers may virtualise long lists.

| Attribute | Type | Default | Notes |
| --- | --- | --- | --- |
| `empty` | string | none | Expression. Text shown when the list has no visible children. |

```
element {"id":"items","type":"list","empty":"Nothing here."}
```

### `tabs`

Shows one of its `tab` children at a time, with a control to switch between
them. Switching is local and does not contact the server unless `onChange`
has an action.

| Attribute | Type | Default | Notes |
| --- | --- | --- | --- |
| `bind` | path | none | Signal holding the id of the selected tab. If missing or not the id of a visible child, the first visible tab is shown. Without `bind`, the selection is renderer state. Literal. |
| `onChange` | handler | none | Runs after the selection changes. Literal. |

```
element {"id":"settings","type":"tabs","bind":"_tab"}
```

### `tab`

One page of a `tabs`, laid out as a column. Its `parent` is required and
must be a `tabs`.

| Attribute | Type | Default | Notes |
| --- | --- | --- | --- |
| `label` | string | the id | Expression. Shown in the tab control. |
| `gap` | enum | `medium` | Expression. `none` · `small` · `medium` · `large`. |

```
element {"id":"general","type":"tab","parent":"settings","label":"General"}
```

### `dialog`

A modal surface above the rest of the interface, laid out as a column. It
cannot have a `parent`. While any dialog is open, the renderer prevents
interaction outside it; the most recently opened is on top.

| Attribute | Type | Default | Notes |
| --- | --- | --- | --- |
| `open` | bool | `true` | Expression. |
| `title` | string | none | Expression. |
| `onDismiss` | handler | none | Runs when the user asks to close (Escape, back gesture, close button). If absent, the user cannot dismiss the dialog. The renderer does not close it itself: the handler must change whatever `open` depends on, or the server must. Literal. |

```
element {"id":"confirm","type":"dialog","title":"Delete project?","open":{"cel":"s._confirm"},"onDismiss":{"patch":{"_confirm":false}}}
```

Prefer keeping a dialog in the tree and toggling `open` with a local signal
over adding and removing it.

## Content

### `text`

| Attribute | Type | Default | Notes |
| --- | --- | --- | --- |
| `text` | string | `""` | Expression. Plain text; line breaks are preserved; no markup. |
| `variant` | enum | `body` | Expression. `h1` · `h2` · `h3` · `body` · `caption` · `code`. Headings are exposed as headings to assistive technology; `code` is monospaced; `caption` is secondary, lower-emphasis text. |

```
element {"id":"title","type":"text","variant":"h1","text":"Inbox"}
```

### `notice`

A message that draws attention: a confirmation, a warning, an error.
Renderers announce `warning` and `failure` notices to assistive technology
when they appear or their text changes.

| Attribute | Type | Default | Notes |
| --- | --- | --- | --- |
| `title` | string | none | Expression. |
| `text` | string | `""` | Expression. |
| `variant` | enum | `info` | Expression. `info` · `success` · `warning` · `failure`. |

```
element {"id":"saved","type":"notice","variant":"success","text":"Saved.","visible":{"cel":"s.saved"}}
```

### `badge`

A short status label, usually shown inline in a row.

| Attribute | Type | Default | Notes |
| --- | --- | --- | --- |
| `text` | string | `""` | Expression. |
| `variant` | enum | `neutral` | Expression. `neutral` · `info` · `success` · `warning` · `failure`. |

```
element {"id":"status","type":"badge","text":{"cel":"s.status"},"variant":{"cel":"{'ok':'success','down':'failure'}[s.status]"}}
```

### `image`

| Attribute | Type | Default | Notes |
| --- | --- | --- | --- |
| `src` | string | `""` | Expression. A URI. Which schemes are fetched is up to the renderer and host; `data:` should be supported. |
| `alt` | string | `""` | Expression. Shown or announced when the image cannot be displayed. Renderers that cannot show images (a terminal) show the alt text, so always set it. |
| `variant` | enum | `inline` | Expression. `inline` · `thumbnail` · `avatar` · `full`. |

```
element {"id":"me","type":"image","variant":"avatar","src":"https://example.com/ada.png","alt":"Ada"}
```

### `divider`

A separator line along the main axis of its parent. No attributes beyond the
common ones.

```
element {"id":"sep","type":"divider"}
```

### `progress`

| Attribute | Type | Default | Notes |
| --- | --- | --- | --- |
| `value` | number or null | `null` | Expression. Between 0 and 1 (clamped). `null` means indeterminate. |
| `label` | string | none | Expression. |
| `variant` | enum | `bar` | Expression. `bar` · `spinner`. |

```
element {"id":"upload","type":"progress","label":"Uploading","value":{"cel":"s.upload.pct"}}
```

## Controls

All controls have `disabled` (see above). Controls with `bind` read and write
the signal at that path: user changes are applied locally at once and reach
the server in the `signals` of the next action. If the server writes the
path, the control shows the new value, even while focused. If the value is
missing or of the wrong type, the control shows its empty state.

### `button`

| Attribute | Type | Default | Notes |
| --- | --- | --- | --- |
| `label` | string | `""` | Expression. |
| `variant` | enum | `secondary` | Expression. `primary` · `secondary` · `plain` · `success` · `failure`. Use `failure` for destructive actions. |
| `onPress` | handler | none | Literal. |

```
element {"id":"save","type":"button","variant":"primary","label":"Save","onPress":{"action":"save","indicator":"_saving"}}
```

### `input`

A text field. The bound signal holds a string, or for the `number` variant a
number (`null` when empty or unparseable).

| Attribute | Type | Default | Notes |
| --- | --- | --- | --- |
| `bind` | path | none | Without `bind` the value is not observable. Literal. |
| `label` | string | none | Expression. |
| `placeholder` | string | none | Expression. |
| `error` | string | `""` | Expression. A validation message; non-empty marks the field invalid. |
| `variant` | enum | `text` | Expression. `text` · `multiline` · `password` · `number` · `email`. |
| `onChange` | handler | none | Runs when the user has finished an edit (on losing focus, or after a short idle period). Not on every keystroke. Literal. |
| `onSubmit` | handler | none | Runs when the user confirms (Enter in a single-line field). Not available for `multiline`. Literal. |

```
element {"id":"email","type":"input","label":"Email","variant":"email","bind":"form.email","error":{"cel":"has(s.errors.email) ? s.errors.email : ''"}}
```

### `checkbox`

A boolean control. The bound signal is `true` or `false`.

| Attribute | Type | Default | Notes |
| --- | --- | --- | --- |
| `bind` | path | none | Literal. |
| `label` | string | `""` | Expression. |
| `variant` | enum | `checkbox` | Expression. `checkbox` · `switch`. |
| `onChange` | handler | none | Runs after each change. Literal. |

```
element {"id":"news","type":"checkbox","variant":"switch","label":"Newsletter","bind":"form.news"}
```

### `select`

A choice of one value from a list. The bound signal holds the selected
option's `value`, or `null`.

| Attribute | Type | Default | Notes |
| --- | --- | --- | --- |
| `bind` | path | none | Literal. |
| `label` | string | none | Expression. |
| `options` | list | `[]` | Expression. Objects with `value` (string) and `label` (string). May be computed from a signal, so the choices can change with a signal patch alone. |
| `variant` | enum | `dropdown` | Expression. `dropdown` · `radio` · `segmented`. |
| `onChange` | handler | none | Runs after each change. Literal. |

```
element {"id":"filter","type":"select","variant":"segmented","bind":"_filter","options":[{"value":"all","label":"All"},{"value":"open","label":"Open"}]}
element {"id":"room","type":"select","label":"Room","bind":"booking.room","options":{"cel":"s.rooms.map(r, {'value': r.id, 'label': r.name})"}}
```

### `slider`

A number within a range. The bound signal holds the number.

| Attribute | Type | Default | Notes |
| --- | --- | --- | --- |
| `bind` | path | none | Literal. |
| `label` | string | none | Expression. |
| `min` | number | `0` | Expression. |
| `max` | number | `100` | Expression. |
| `step` | number | `1` | Expression. |
| `onChange` | handler | none | Runs when the user releases the slider, not continuously while dragging. Literal. |

```
element {"id":"volume","type":"slider","label":"Volume","bind":"volume","max":11}
```

## Handlers

Every handler attribute takes the same object. It needs at least one of
`patch`, `open` and `action`.

| Member | Type | Notes |
| --- | --- | --- |
| `patch` | object | A merge patch applied to the signals locally, first. Leaf values may be expressions. |
| `open` | string | `button` only. A URL the renderer asks its host to open (a web page, `mailto:`…), after the patch. Non-empty string or expression; the host decides which URLs it opens. |
| `action` | string | Non-empty. Sends `action {"name":...,"payload":...,"signals":...}` to the server. |
| `payload` | any | Only with `action`. Copied verbatim into the action. Literal. |
| `indicator` | path | Only with `action`. A signal path whose first segment starts with `_`; set to `true` when the action is sent. The server must reset it. |

An element with an invalid handler is rejected.

## Choosing a component

- Headings and paragraphs: `text` with `h1`–`h3` / `body` / `caption`.
- A status that changes: `badge` (short, inline) or `notice` (a sentence,
  draws attention).
- Feedback after an action: a `notice` whose `visible` and `variant` are
  expressions, not one added and removed.
- A confirmation: a root `dialog` whose `open` reads a local signal.
- A link: a `plain` `button` whose handler has `open`.
- Switching views locally: `tabs` with `bind` to a local signal, or
  `visible` expressions on sibling containers.
- State that only the server may confirm: `button`/`badge`/`text`
  attributes computed from a server-owned signal, or a bound control kept
  disabled and pending until the server replies with the real value (see
  [server-guide.md](https://hypereffect.dev/server-guide.md#server-confirmed-state)).
