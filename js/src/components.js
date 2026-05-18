// The eighteen components, their attributes and the nesting rules, as on the
// Components page.
//
// Attribute types:
//   'string' | 'bool' | 'number' | 'number?' (number or null) | 'options'
//   ['enum', ...values] (the first value listed is the default)
//   'path' and 'handler' are structural.

const GAP = ['enum', 'none', 'small', 'medium', 'large'];
const ALIGN = ['enum', 'start', 'center', 'end', 'stretch'];
const JUSTIFY = ['enum', 'start', 'center', 'end', 'between'];

const attr = (type, def) => ({ type, def });
const enumOf = (values, def) => ({ type: ['enum', ...values], def });
const gap = (def) => ({ type: GAP, def });
const control = { disabled: attr('bool', false) };

export const COMPONENTS = {
  column: { gap: gap('medium'), align: { type: ALIGN, def: 'stretch' } },
  row: { gap: gap('small'), align: { type: ALIGN, def: 'center' }, justify: { type: JUSTIFY, def: 'start' }, wrap: attr('bool', false) },
  card: { title: attr('string', null), gap: gap('medium') },
  list: { empty: attr('string', null) },
  tabs: { bind: attr('path', null), onChange: attr('handler', null) },
  tab: { label: attr('string', undefined), gap: gap('medium') },
  dialog: { open: attr('bool', true), title: attr('string', null), onDismiss: attr('handler', null) },
  text: { text: attr('string', ''), variant: enumOf(['h1', 'h2', 'h3', 'body', 'caption', 'code'], 'body') },
  notice: { title: attr('string', null), text: attr('string', ''), variant: enumOf(['info', 'success', 'warning', 'failure'], 'info') },
  badge: { text: attr('string', ''), variant: enumOf(['neutral', 'info', 'success', 'warning', 'failure'], 'neutral') },
  image: { src: attr('string', ''), alt: attr('string', ''), variant: enumOf(['inline', 'thumbnail', 'avatar', 'full'], 'inline') },
  divider: {},
  progress: { value: attr('number?', null), label: attr('string', null), variant: enumOf(['bar', 'spinner'], 'bar') },
  button: {
    ...control, label: attr('string', ''),
    variant: enumOf(['primary', 'secondary', 'plain', 'success', 'failure'], 'secondary'),
    onPress: attr('handler', null),
  },
  input: {
    ...control, bind: attr('path', null), label: attr('string', null), placeholder: attr('string', null),
    error: attr('string', ''), variant: enumOf(['text', 'multiline', 'password', 'number', 'email'], 'text'),
    onChange: attr('handler', null), onSubmit: attr('handler', null),
  },
  checkbox: {
    ...control, bind: attr('path', null), label: attr('string', ''),
    variant: enumOf(['checkbox', 'switch'], 'checkbox'), onChange: attr('handler', null),
  },
  select: {
    ...control, bind: attr('path', null), label: attr('string', null), options: attr('options', []),
    variant: enumOf(['dropdown', 'radio', 'segmented'], 'dropdown'), onChange: attr('handler', null),
  },
  slider: {
    ...control, bind: attr('path', null), label: attr('string', null),
    min: attr('number', 0), max: attr('number', 100), step: attr('number', 1), onChange: attr('handler', null),
  },
};

for (const c of Object.values(COMPONENTS)) c.visible = attr('bool', true);

const CONTAINERS = new Set(['column', 'row', 'card', 'list', 'tab', 'dialog']);

// Whether an element of type `child` may be placed in `parent` (a component
// name, or null for the root).
export function accepts(parent, child) {
  if (parent === null) return child !== 'tab';
  if (parent === 'tabs') return child === 'tab';
  if (child === 'tab' || child === 'dialog') return false;
  return CONTAINERS.has(parent);
}
