// The eighteen components, their attributes and the nesting rules.

export const COMPONENTS = [
  'column', 'row', 'card', 'list', 'tabs', 'tab', 'dialog', 'text', 'notice', 'badge', 'image',
  'divider', 'progress', 'button', 'input', 'checkbox', 'select', 'slider',
] as const;

export type Component = (typeof COMPONENTS)[number];

export function isComponent(name: unknown): name is Component {
  return typeof name === 'string' && (COMPONENTS as readonly string[]).includes(name);
}

// The type of an attribute. `enum` values not in the list are treated as the
// default; `path` (a signal path) and `handler` are structural.
export type AttrType =
  | { kind: 'string' | 'bool' | 'number' | 'number?' | 'options' | 'path' | 'handler' }
  | { kind: 'enum'; values: readonly string[] };

export interface Attr {
  name: string;
  type: AttrType;
  // The value of an absent attribute. `{ id: true }` means the element's id
  // (the label of a tab).
  default: unknown;
}

export function isStructural(t: AttrType): boolean {
  return t.kind === 'path' || t.kind === 'handler';
}

// The default for an element with this id.
export function defaultValue(a: Attr, id: string): unknown {
  if (a.default === ID) return id;
  if (a.type.kind === 'options') return [];
  return a.default;
}

const ID = { id: true };

const attr = (name: string, kind: Exclude<AttrType['kind'], 'enum'>, def: unknown = null): Attr => ({
  name, type: { kind }, default: def,
});
const enumOf = (name: string, def: string, ...values: string[]): Attr => ({
  name, type: { kind: 'enum', values }, default: def,
});
const gap = (def: string) => enumOf('gap', def, 'none', 'small', 'medium', 'large');
const align = (def: string) => enumOf('align', def, 'start', 'center', 'end', 'stretch');
const visible = attr('visible', 'bool', true);
const disabled = attr('disabled', 'bool', false);
const bind = attr('bind', 'path');

const ATTRS: Record<Component, Attr[]> = {
  column: [visible, gap('medium'), align('stretch')],
  row: [visible, gap('small'), align('center'),
    enumOf('justify', 'start', 'start', 'center', 'end', 'between'), attr('wrap', 'bool', false)],
  card: [visible, attr('title', 'string'), gap('medium')],
  list: [visible, attr('empty', 'string')],
  tabs: [visible, bind, attr('onChange', 'handler')],
  tab: [visible, attr('label', 'string', ID), gap('medium')],
  dialog: [visible, attr('open', 'bool', true), attr('title', 'string'), attr('onDismiss', 'handler')],
  text: [visible, attr('text', 'string', ''),
    enumOf('variant', 'body', 'h1', 'h2', 'h3', 'body', 'caption', 'code')],
  notice: [visible, attr('title', 'string'), attr('text', 'string', ''),
    enumOf('variant', 'info', 'info', 'success', 'warning', 'failure')],
  badge: [visible, attr('text', 'string', ''),
    enumOf('variant', 'neutral', 'neutral', 'info', 'success', 'warning', 'failure')],
  image: [visible, attr('src', 'string', ''), attr('alt', 'string', ''),
    enumOf('variant', 'inline', 'inline', 'thumbnail', 'avatar', 'full')],
  divider: [visible],
  progress: [visible, attr('value', 'number?'), attr('label', 'string'),
    enumOf('variant', 'bar', 'bar', 'spinner')],
  button: [visible, disabled, attr('label', 'string', ''),
    enumOf('variant', 'secondary', 'primary', 'secondary', 'plain', 'success', 'failure'),
    attr('onPress', 'handler')],
  input: [visible, disabled, bind, attr('label', 'string'), attr('placeholder', 'string'),
    attr('error', 'string', ''),
    enumOf('variant', 'text', 'text', 'multiline', 'password', 'number', 'email'),
    attr('onChange', 'handler'), attr('onSubmit', 'handler')],
  checkbox: [visible, disabled, bind, attr('label', 'string', ''),
    enumOf('variant', 'checkbox', 'checkbox', 'switch'), attr('onChange', 'handler')],
  select: [visible, disabled, bind, attr('label', 'string'), attr('options', 'options'),
    enumOf('variant', 'dropdown', 'dropdown', 'radio', 'segmented'), attr('onChange', 'handler')],
  slider: [visible, disabled, bind, attr('label', 'string'), attr('min', 'number', 0),
    attr('max', 'number', 100), attr('step', 'number', 1), attr('onChange', 'handler')],
};

// The attributes of a component other than `id`, `type`, `parent` and
// `before`, including `visible` and, for controls, `disabled`.
export function attrs(c: Component): readonly Attr[] {
  return ATTRS[c];
}

export function attrOf(c: Component, name: string): Attr | undefined {
  return ATTRS[c].find((a) => a.name === name);
}

// Whether this component has a `disabled` attribute.
export function isControl(c: Component): boolean {
  return ['button', 'input', 'checkbox', 'select', 'slider'].includes(c);
}

const CONTAINERS: readonly Component[] = ['column', 'row', 'card', 'list', 'tab', 'dialog'];

// Whether an element of type child may be placed in parent (null for the
// root).
export function accepts(parent: Component | null, child: Component): boolean {
  if (parent === null) return child !== 'tab';
  if (parent === 'tabs') return child === 'tab';
  return child !== 'tab' && child !== 'dialog' && CONTAINERS.includes(parent);
}
