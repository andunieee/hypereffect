// A task list: adding, checking off and deleting tasks, a local filter, and
// a confirmation dialog. The TypeScript port of the demo on hypereffect.dev.

import { type Action, type App, cel, type Element, Handler, type JsonObject, type Outbox, ui } from '../src/index.ts';

interface Task {
  id: string;
  title: string;
  done: boolean;
}

export class Todos implements App {
  private tasks: Task[] = [];
  private next = 1;

  constructor() {
    for (const [title, done] of [['Water the plants', true], ['Call the bank', false], ['Read the spec', false]] as const) {
      this.tasks.push({ id: this.newId(), title, done });
    }
  }

  private newId(): string {
    return `t${this.next++}`;
  }

  private row(task: Task): Element[] {
    const { id } = task;
    const done = `s.done.${id}`;
    return [
      ui.row(id)
        .parent('items')
        .justify('between')
        .visible(cel(`s._filter == 'all' || (s._filter == 'done') == ${done}`)),
      ui.checkbox(`${id}-check`)
        .parent(id)
        .label(task.title)
        .bind(`done.${id}`)
        .onChange(Handler.action('toggle').withPayload(id)),
      ui.button(`${id}-del`)
        .parent(id)
        .label('Delete')
        .variant('plain')
        .onPress(Handler.action('delete').withPayload(id)),
    ];
  }

  private doneSignals(): JsonObject {
    return Object.fromEntries(this.tasks.map((t) => [t.id, t.done]));
  }

  hello(out: Outbox): void {
    out.signal({
      new: '',
      done: this.doneSignals(),
      _filter: 'all',
      _adding: false,
      _confirm: false,
      _clearing: false,
    });
    out.element(ui.card('todos').title('Tasks'));
    out.element(ui.row('add-row').parent('todos'));
    out.element(
      ui.input('new')
        .parent('add-row')
        .placeholder('New task')
        .bind('new')
        .error(cel("size(s.new) > 80 ? 'Keep it under 80 characters.' : ''"))
        .onSubmit(Handler.action('add').withIndicator('_adding')),
    );
    out.element(
      ui.button('add')
        .parent('add-row')
        .variant('primary')
        .label(cel("s._adding ? 'Adding…' : 'Add'"))
        .disabled(cel("s._adding || s.new.trim() == '' || size(s.new) > 80"))
        .onPress(Handler.action('add').withIndicator('_adding')),
    );
    out.element(
      ui.select('filter')
        .parent('todos')
        .variant('segmented')
        .bind('_filter')
        .options([
          { value: 'all', label: 'All' },
          { value: 'open', label: 'Open' },
          { value: 'done', label: 'Done' },
        ]),
    );
    out.element(ui.list('items').parent('todos').empty('Nothing here.'));
    for (const t of this.tasks) for (const e of this.row(t)) out.element(e);
    out.element(ui.row('footer').parent('todos').justify('between'));
    out.element(ui.text('left').parent('footer').variant('caption').text(cel(
      "string(s.done.filter(k, !s.done[k]).size()) + ' of ' + string(size(s.done)) + ' left'",
    )));
    out.element(
      ui.button('clear')
        .parent('footer')
        .variant('failure')
        .label('Clear completed…')
        .disabled(cel('!s.done.exists(k, s.done[k]) || s._clearing'))
        .onPress(Handler.patch({ _confirm: true })),
    );
    out.element(
      ui.dialog('confirm')
        .title('Clear completed tasks?')
        .open(cel('s._confirm'))
        .onDismiss(Handler.patch({ _confirm: false })),
    );
    out.element(ui.text('confirm-text').parent('confirm').text(cel(
      "string(s.done.filter(k, s.done[k]).size()) + ' tasks will be deleted.'",
    )));
    out.element(ui.row('confirm-row').parent('confirm').justify('end'));
    out.element(
      ui.button('confirm-no')
        .parent('confirm-row')
        .label('Cancel')
        .onPress(Handler.patch({ _confirm: false })),
    );
    out.element(
      ui.button('confirm-yes')
        .parent('confirm-row')
        .variant('failure')
        .label('Delete')
        .onPress(Handler.action('clear').withPatch({ _confirm: false }).withIndicator('_clearing')),
    );
  }

  action(out: Outbox, action: Action): void {
    switch (action.name) {
      case 'add': {
        const raw = action.signal('new');
        const title = typeof raw === 'string' ? raw.trim() : '';
        if (title === '' || [...title].length > 80) {
          out.signal({ _adding: false });
          return;
        }
        const task = { id: this.newId(), title, done: false };
        // New tasks go at the top.
        const first = this.tasks[0]?.id;
        // The signal comes first so that the row's expressions can read
        // done.<id> as soon as it arrives.
        out.signal({ new: '', done: { [task.id]: false }, _adding: false });
        this.row(task).forEach((e, i) => out.element(i === 0 && first ? e.before(first) : e));
        this.tasks.unshift(task);
        break;
      }
      case 'toggle': {
        const id = action.payload;
        const task = this.tasks.find((t) => t.id === id);
        if (typeof id !== 'string' || !task) return;
        const done = action.signal(`done.${id}`);
        if (typeof done === 'boolean') task.done = done;
        out.signal({ done: { [id]: task.done } });
        break;
      }
      case 'delete': {
        const id = action.payload;
        const i = this.tasks.findIndex((t) => t.id === id);
        if (typeof id !== 'string' || i < 0) return;
        this.tasks.splice(i, 1);
        out.remove(id);
        out.signal({ done: { [id]: null } });
        break;
      }
      case 'clear': {
        const patch: JsonObject = {};
        for (const t of this.tasks.filter((t) => t.done)) {
          out.remove(t.id);
          patch[t.id] = null;
        }
        this.tasks = this.tasks.filter((t) => !t.done);
        out.signal({ done: patch, _clearing: false });
        break;
      }
    }
  }
}
