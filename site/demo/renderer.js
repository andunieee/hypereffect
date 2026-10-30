// An ad-hoc DOM renderer for the hypereffect components, on top of the
// Session from the TypeScript library. The Session owns the tree, signals and
// expressions; this file only turns resolved elements into HTML widgets and
// user input into writes and handler triggers.

const CHANGE_IDLE_MS = 700;
const OPEN_SCHEMES = new Set(['https:', 'http:', 'mailto:']);

// Opens a URL a handler asked for, as a Session's onOpen, in a new tab with no
// reference back to this page. Returns false for URLs with other schemes.
export function openUrl(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (!OPEN_SCHEMES.has(u.protocol)) return false;
  window.open(u.href, '_blank', 'noopener,noreferrer');
  return true;
}

let uid = 0;
const h = (tag, props = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...kids);
  return el;
};

const setText = (el, s) => { if (el.textContent !== s) el.textContent = s; };

const GAPS = { none: '0', small: '6px', medium: '12px', large: '22px' };
const FLEX = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch', between: 'space-between' };

export class DomRenderer {
  // `surface` is an element owned by the host. Diagnostics go to `onDiagnostic`.
  constructor(session, surface) {
    this.s = session;
    this.nodes = new Map();
    this.fieldset = h('fieldset', { class: 'he-root' });
    this.rootBody = h('div', { class: 'he-column he-body' });
    this.dialogs = h('div', { class: 'he-dialogs' });
    this.banner = h('p', { class: 'he-banner', hidden: true }, 'Disconnected');
    this.fieldset.append(this.banner, this.rootBody, this.dialogs);
    surface.replaceChildren(this.fieldset);
    this.tabState = new Map();
  }

  // Applies an update from Session.onUpdate.
  update(u) {
    for (const id of u.removed) {
      const n = this.nodes.get(id);
      if (!n) continue;
      if (n.dialog?.open) n.dialog.close();
      n.el.remove();
      this.nodes.delete(id);
      this.tabState.delete(id);
    }
    for (const id of u.created) {
      const old = this.nodes.get(id);
      const n = this.build(id, this.s.get(id).type);
      if (old) old.el.replaceWith(n.el);
      this.nodes.set(id, n);
    }
    for (const id of u.reordered) this.place(id);
    for (const id of u.updated) {
      const n = this.nodes.get(id);
      if (n) this.apply(n, this.s.get(id));
    }
    if (u.connection) {
      this.fieldset.disabled = !this.s.connected;
      this.banner.hidden = this.s.connected;
    }
  }

  // Puts the children of `id` ('' for the root) in order.
  place(id) {
    const ids = this.s.children(id || null);
    if (id === '') {
      this.reconcile(this.rootBody, ids.filter((c) => this.nodes.get(c)?.type !== 'dialog'));
      this.reconcile(this.dialogs, ids.filter((c) => this.nodes.get(c)?.type === 'dialog'));
      return;
    }
    const n = this.nodes.get(id);
    if (n?.body) this.reconcile(n.body, ids);
  }

  reconcile(container, ids) {
    const want = ids.map((c) => this.nodes.get(c)?.el).filter(Boolean);
    want.forEach((el, i) => {
      if (container.children[i] !== el) container.insertBefore(el, container.children[i] ?? null);
    });
    while (container.children.length > want.length) container.lastElementChild.remove();
  }

  // --- building ------------------------------------------------------------

  build(id, type) {
    const n = { id, type, el: null, body: null };
    const trig = (ev) => this.s.trigger(id, ev);
    const write = (v) => {
      const bind = this.s.attr(id, 'bind');
      if (bind) this.s.write(bind, v);
    };
    switch (type) {
      case 'column':
      case 'row':
      case 'tab':
        n.el = n.body = h('div', { class: `he-${type === 'tab' ? 'column' : type}` });
        break;
      case 'card':
        n.title = h('h3', { class: 'he-card-title' });
        n.body = h('div', { class: 'he-column' });
        n.el = h('section', { class: 'he-card' }, n.title, n.body);
        break;
      case 'list':
        n.body = h('div', { class: 'he-items' });
        n.empty = h('p', { class: 'he-empty' });
        n.el = h('div', { class: 'he-list' }, n.body, n.empty);
        break;
      case 'tabs':
        n.tablist = h('div', { class: 'he-tablist', role: 'tablist' });
        n.body = h('div', { class: 'he-tabpanels' });
        n.el = h('div', { class: 'he-tabs' }, n.tablist, n.body);
        break;
      case 'dialog': {
        n.title = h('h2', { class: 'he-dialog-title' });
        n.close = h('button', { class: 'he-dialog-close', type: 'button', 'aria-label': 'Close', onclick: () => trig('onDismiss') }, '×');
        n.body = h('div', { class: 'he-column' });
        n.dialog = h('dialog', { class: 'he-dialog' }, h('header', {}, n.title, n.close), n.body);
        // Escape asks to dismiss; the dialog closes only if the server or a
        // patch changes `open`.
        n.dialog.addEventListener('cancel', (e) => { e.preventDefault(); trig('onDismiss'); });
        n.el = n.dialog;
        break;
      }
      case 'text':
        n.el = h('p', { class: 'he-text' });
        break;
      case 'notice':
        n.title = h('strong', { class: 'he-notice-title' });
        n.text = h('span', { class: 'he-notice-text' });
        n.el = h('div', { class: 'he-notice' }, n.title, n.text);
        break;
      case 'badge':
        n.el = h('span', { class: 'he-badge' });
        break;
      case 'image':
        n.el = h('img', { class: 'he-image', loading: 'lazy' });
        break;
      case 'divider':
        n.el = h('hr', { class: 'he-divider' });
        break;
      case 'progress':
        n.label = h('span', { class: 'he-label' });
        n.bar = h('progress', { max: 1 });
        n.spinner = h('span', { class: 'he-spinner', role: 'progressbar' });
        n.el = h('div', { class: 'he-progress' }, n.label, n.bar, n.spinner);
        break;
      case 'button':
        n.el = h('button', { type: 'button', class: 'he-button', onclick: () => trig('onPress') });
        break;
      case 'input': {
        n.label = h('span', { class: 'he-label' });
        n.error = h('span', { class: 'he-error', 'aria-live': 'polite' });
        n.el = h('label', { class: 'he-field' }, n.label, h('span'), n.error);
        n.controlVariant = null;
        n.fireChange = () => {
          clearTimeout(n.idle);
          if (n.pending) { n.pending = false; trig('onChange'); }
        };
        n.onInput = () => {
          write(this.readInput(n));
          n.pending = true;
          clearTimeout(n.idle);
          n.idle = setTimeout(n.fireChange, CHANGE_IDLE_MS);
        };
        break;
      }
      case 'checkbox':
        n.box = h('input', {
          type: 'checkbox',
          onchange: () => { write(n.box.checked); trig('onChange'); },
        });
        n.label = h('span');
        n.el = h('label', { class: 'he-check' }, n.box, n.label);
        break;
      case 'select':
        n.label = h('span', { class: 'he-label' });
        n.control = h('span');
        n.el = h('div', { class: 'he-field' }, n.label, n.control);
        n.choose = (v) => { write(v); trig('onChange'); };
        break;
      case 'slider': {
        n.label = h('span', { class: 'he-label' });
        n.out = h('output');
        n.range = h('input', {
          type: 'range',
          oninput: () => { write(Number(n.range.value)); n.out.value = n.range.value; },
          onchange: () => trig('onChange'),
        });
        const lid = `he-${++uid}`;
        n.range.id = lid;
        n.label.id = lid + '-l';
        n.range.setAttribute('aria-labelledby', n.label.id);
        n.el = h('div', { class: 'he-field' }, h('span', { class: 'he-slider-head' }, n.label, n.out), n.range);
        break;
      }
      default:
        n.el = h('div', { class: 'he-unknown' }, `[${type}]`);
    }
    n.el.dataset.id = id;
    return n;
  }

  // --- applying attributes -------------------------------------------------

  apply(n, r) {
    const a = r.attrs;
    // A tab's visibility is decided by its tabs, which also hides unselected tabs.
    if (r.type !== 'tab') n.el.hidden = !a.visible;
    const layout = (el, def) => {
      el.style.gap = GAPS[a.gap] ?? GAPS[def];
      if (a.align) el.style.alignItems = FLEX[a.align];
      if (a.justify) el.style.justifyContent = FLEX[a.justify];
    };
    switch (r.type) {
      case 'column':
        layout(n.el);
        break;
      case 'row':
        layout(n.el);
        n.el.classList.toggle('he-wrap', a.wrap);
        break;
      case 'tab':
        layout(n.el);
        break;
      case 'card':
        setText(n.title, a.title ?? '');
        n.title.hidden = a.title === null;
        layout(n.body);
        break;
      case 'list': {
        const anyVisible = r.children.some((c) => this.s.attr(c, 'visible'));
        setText(n.empty, a.empty ?? '');
        n.empty.hidden = anyVisible || a.empty === null;
        break;
      }
      case 'tabs':
        this.applyTabs(n, r);
        break;
      case 'dialog':
        setText(n.title, a.title ?? '');
        n.title.hidden = a.title === null;
        n.close.hidden = !a.onDismiss;
        layout(n.body);
        if (a.open && a.visible && !n.dialog.open) {
          if (n.dialog.isConnected) n.dialog.showModal();
        } else if ((!a.open || !a.visible) && n.dialog.open) {
          n.dialog.close();
        }
        break;
      case 'text': {
        const tag = { h1: 'h1', h2: 'h2', h3: 'h3', code: 'pre' }[a.variant] ?? 'p';
        if (n.el.tagName.toLowerCase() !== tag) {
          const el = h(tag, { class: 'he-text' });
          el.dataset.id = n.id;
          n.el.replaceWith(el);
          n.el = el;
          n.el.hidden = !a.visible;
        }
        n.el.className = `he-text he-${a.variant}`;
        setText(n.el, a.text);
        break;
      }
      case 'notice':
        n.el.className = `he-notice he-${a.variant}`;
        n.el.setAttribute('role', a.variant === 'warning' || a.variant === 'failure' ? 'alert' : 'status');
        setText(n.title, a.title ?? '');
        n.title.hidden = a.title === null;
        setText(n.text, a.text);
        break;
      case 'badge':
        n.el.className = `he-badge he-${a.variant}`;
        setText(n.el, a.text);
        break;
      case 'image':
        n.el.className = `he-image he-${a.variant}`;
        n.el.alt = a.alt;
        // Host policy: only data: and https: images are fetched.
        if (/^(data:|https:)/i.test(a.src)) { if (n.el.getAttribute('src') !== a.src) n.el.src = a.src; }
        else n.el.removeAttribute('src');
        break;
      case 'progress': {
        setText(n.label, a.label ?? '');
        n.label.hidden = a.label === null;
        const spinner = a.variant === 'spinner';
        n.bar.hidden = spinner;
        n.spinner.hidden = !spinner;
        if (a.value === null) n.bar.removeAttribute('value');
        else n.bar.value = Math.min(1, Math.max(0, a.value));
        if (a.label) n.bar.setAttribute('aria-label', a.label);
        break;
      }
      case 'button':
        n.el.className = `he-button he-${a.variant}`;
        n.el.disabled = a.disabled;
        setText(n.el, a.label);
        break;
      case 'input':
        this.applyInput(n, a);
        break;
      case 'checkbox': {
        n.box.disabled = a.disabled;
        n.box.setAttribute('role', a.variant === 'switch' ? 'switch' : 'checkbox');
        n.el.classList.toggle('he-switch', a.variant === 'switch');
        setText(n.label, a.label);
        if (a.bind) n.box.checked = this.s.value(a.bind) === true;
        break;
      }
      case 'select':
        this.applySelect(n, a);
        break;
      case 'slider': {
        setText(n.label, a.label ?? '');
        n.label.hidden = a.label === null;
        Object.assign(n.range, { min: a.min, max: a.max, step: a.step, disabled: a.disabled });
        if (a.bind) {
          const v = this.s.value(a.bind);
          const shown = typeof v === 'number' ? v : a.min;
          if (Number(n.range.value) !== shown) n.range.value = shown;
        }
        n.out.value = n.range.value;
        break;
      }
    }
  }

  applyTabs(n, r) {
    const tabs = r.children.filter((c) => this.s.attr(c, 'visible'));
    const bound = r.attrs.bind ? this.s.value(r.attrs.bind) : this.tabState.get(n.id);
    const selected = tabs.includes(bound) ? bound : tabs[0];
    n.tablist.replaceChildren(...tabs.map((c) => h('button', {
      type: 'button',
      role: 'tab',
      class: 'he-tab',
      'aria-selected': c === selected ? 'true' : 'false',
      onclick: () => {
        if (c === selected) return;
        if (r.attrs.bind) this.s.write(r.attrs.bind, c);
        else { this.tabState.set(n.id, c); this.apply(n, this.s.get(n.id)); }
        this.s.trigger(n.id, 'onChange');
      },
    }, this.s.attr(c, 'label'))));
    for (const c of r.children) {
      const child = this.nodes.get(c);
      if (child) child.el.hidden = c !== selected;
    }
  }

  readInput(n) {
    const v = n.control.value;
    if (n.controlVariant !== 'number') return v;
    if (v.trim() === '') return null;
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
  }

  applyInput(n, a) {
    const multiline = a.variant === 'multiline';
    const kind = multiline ? 'multiline' : a.variant;
    if (n.controlVariant !== kind) {
      const focused = n.control && document.activeElement === n.control;
      const c = multiline
        ? h('textarea', { rows: 3 })
        : h('input', { type: { password: 'password', number: 'text', email: 'email' }[a.variant] ?? 'text' });
      if (a.variant === 'number') c.inputMode = 'decimal';
      c.addEventListener('input', n.onInput);
      c.addEventListener('blur', n.fireChange);
      c.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !multiline && !e.isComposing) {
          e.preventDefault();
          n.fireChange();
          this.s.trigger(n.id, 'onSubmit');
        }
      });
      const old = n.el.children[1];
      if (n.control) c.value = n.control.value;
      old.replaceWith(c);
      n.control = c;
      n.controlVariant = kind;
      if (focused) c.focus();
    }
    const c = n.control;
    setText(n.label, a.label ?? '');
    n.label.hidden = a.label === null;
    c.placeholder = a.placeholder ?? '';
    c.disabled = a.disabled;
    setText(n.error, a.error);
    c.setAttribute('aria-invalid', a.error !== '' ? 'true' : 'false');
    if (a.bind) {
      // Show the bound value, even with focus, unless what the field shows
      // already means the same (so typing "1." in a number field survives).
      const v = this.s.value(a.bind);
      if (n.controlVariant === 'number') {
        if (this.readInput(n) !== (typeof v === 'number' ? v : null)) c.value = typeof v === 'number' ? String(v) : '';
      } else {
        const want = typeof v === 'string' ? v : '';
        if (c.value !== want) c.value = want;
      }
    }
  }

  applySelect(n, a) {
    const v = a.bind ? this.s.value(a.bind) : undefined;
    const key = JSON.stringify([a.variant, a.options, a.label]);
    if (n.key !== key) {
      n.key = key;
      const name = `he-${++uid}`;
      let control;
      if (a.variant === 'radio') {
        n.inputs = a.options.map((o) => h('input', { type: 'radio', name, value: o.value, onchange: () => n.choose(o.value) }));
        control = h('div', { class: 'he-radios', role: 'radiogroup' },
          ...a.options.map((o, i) => h('label', { class: 'he-check' }, n.inputs[i], h('span', {}, o.label))));
      } else if (a.variant === 'segmented') {
        n.inputs = a.options.map((o) => h('button', { type: 'button', class: 'he-segment', onclick: () => n.choose(o.value) }, o.label));
        control = h('div', { class: 'he-segmented', role: 'group' }, ...n.inputs);
      } else {
        const placeholder = h('option', { value: '', disabled: true }, 'Choose…');
        control = h('select', { onchange: () => n.choose(control.value) },
          placeholder, ...a.options.map((o) => h('option', { value: o.value }, o.label)));
        n.inputs = null;
      }
      n.control.replaceWith(control);
      n.control = control;
      if (a.label !== null) control.setAttribute('aria-label', a.label);
    }
    setText(n.label, a.label ?? '');
    n.label.hidden = a.label === null;
    const selected = a.options.some((o) => o.value === v) ? v : null;
    if (n.inputs) {
      n.inputs.forEach((el, i) => {
        el.disabled = a.disabled;
        const on = a.options[i].value === selected;
        if (el.type === 'radio') el.checked = on;
        else el.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    } else {
      n.control.disabled = a.disabled;
      n.control.value = selected ?? '';
    }
  }
}
