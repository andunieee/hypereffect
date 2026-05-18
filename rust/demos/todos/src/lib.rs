//! A task list: adding, checking off and deleting tasks, a local filter, and
//! a confirmation dialog.

use hypereffect::ui::*;
use hypereffect::{cel, json, Action, App, Element, Handler, Map, Outbox, Value};

struct Task {
    id: String,
    title: String,
    done: bool,
}

pub struct Todos {
    tasks: Vec<Task>,
    next: u32,
}

impl Default for Todos {
    fn default() -> Self {
        let mut t = Todos {
            tasks: Vec::new(),
            next: 1,
        };
        for (title, done) in [
            ("Water the plants", true),
            ("Call the bank", false),
            ("Read the spec", false),
        ] {
            let id = t.new_id();
            t.tasks.push(Task {
                id,
                title: title.into(),
                done,
            });
        }
        t
    }
}

impl Todos {
    fn new_id(&mut self) -> String {
        let id = format!("t{}", self.next);
        self.next += 1;
        id
    }

    fn row(&self, task: &Task) -> [Element; 3] {
        let id = &task.id;
        let done = format!("signals.done.{id}");
        [
            row(id.as_str())
                .parent("items")
                .justify("between")
                .visible(cel(format!(
                    "signals._filter == 'all' || (signals._filter == 'done') == {done}"
                ))),
            checkbox(format!("{id}-check"))
                .parent(id.as_str())
                .label(task.title.as_str())
                .bind(format!("done.{id}"))
                .on_change(Handler::action("toggle").payload(id.as_str())),
            button(format!("{id}-del"))
                .parent(id.as_str())
                .label("Delete")
                .variant("plain")
                .on_press(Handler::action("delete").payload(id.as_str())),
        ]
    }

    fn done_signals(&self) -> Value {
        Value::Object(
            self.tasks
                .iter()
                .map(|t| (t.id.clone(), t.done.into()))
                .collect(),
        )
    }
}

impl App for Todos {
    fn hello(&mut self, out: &mut Outbox, _signals: &Map<String, Value>) {
        out.signal(json!({
            "new": "",
            "done": self.done_signals(),
            "_filter": "all",
            "_adding": false,
            "_confirm": false,
            "_clearing": false,
        }));
        out.element(card("todos").title("Tasks"));
        out.element(row("add-row").parent("todos"));
        out.element(
            input("new")
                .parent("add-row")
                .placeholder("New task")
                .bind("new")
                .error(cel(
                    "size(signals.new) > 80 ? 'Keep it under 80 characters.' : ''",
                ))
                .on_submit(Handler::action("add").indicator("_adding")),
        );
        out.element(
            button("add")
                .parent("add-row")
                .variant("primary")
                .label(cel("signals._adding ? 'Adding…' : 'Add'"))
                .disabled(cel(
                    "signals._adding || signals.new.trim() == '' || size(signals.new) > 80",
                ))
                .on_press(Handler::action("add").indicator("_adding")),
        );
        out.element(
            select("filter")
                .parent("todos")
                .variant("segmented")
                .bind("_filter")
                .options(json!([
                    { "value": "all", "label": "All" },
                    { "value": "open", "label": "Open" },
                    { "value": "done", "label": "Done" },
                ])),
        );
        out.element(list("items").parent("todos").empty("Nothing here."));
        for t in &self.tasks {
            for e in self.row(t) {
                out.element(e);
            }
        }
        out.element(row("footer").parent("todos").justify("between"));
        out.element(text("left").parent("footer").variant("caption").text(cel(
            "string(signals.done.filter(k, !signals.done[k]).size()) + ' of ' + \
                     string(size(signals.done)) + ' left'",
        )));
        out.element(
            button("clear")
                .parent("footer")
                .variant("failure")
                .label("Clear completed…")
                .disabled(cel(
                    "!signals.done.exists(k, signals.done[k]) || signals._clearing",
                ))
                .on_press(Handler::patch(json!({ "_confirm": true }))),
        );
        out.element(
            dialog("confirm")
                .title("Clear completed tasks?")
                .open(cel("signals._confirm"))
                .on_dismiss(Handler::patch(json!({ "_confirm": false }))),
        );
        out.element(text("confirm-text").parent("confirm").text(cel(
            "string(signals.done.filter(k, signals.done[k]).size()) + ' tasks will be deleted.'",
        )));
        out.element(row("confirm-row").parent("confirm").justify("end"));
        out.element(
            button("confirm-no")
                .parent("confirm-row")
                .label("Cancel")
                .on_press(Handler::patch(json!({ "_confirm": false }))),
        );
        out.element(
            button("confirm-yes")
                .parent("confirm-row")
                .variant("failure")
                .label("Delete")
                .on_press(
                    Handler::action("clear")
                        .with_patch(json!({ "_confirm": false }))
                        .indicator("_clearing"),
                ),
        );
    }

    fn action(&mut self, out: &mut Outbox, action: &Action) {
        match action.name.as_str() {
            "add" => {
                let title = action
                    .signal("new")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .trim()
                    .to_string();
                if title.is_empty() || title.chars().count() > 80 {
                    out.signal(json!({ "_adding": false }));
                    return;
                }
                let id = self.new_id();
                let task = Task {
                    id: id.clone(),
                    title,
                    done: false,
                };
                // New tasks go at the top.
                let first = self.tasks.first().map(|t| t.id.clone());
                // The signal comes first so that the row's expressions can
                // read done.<id> as soon as it arrives.
                out.signal(json!({ "new": "", "done": { &id: false }, "_adding": false }));
                for (i, e) in self.row(&task).into_iter().enumerate() {
                    out.element(match (&first, i) {
                        (Some(f), 0) => e.before(f.as_str()),
                        _ => e,
                    });
                }
                self.tasks.insert(0, task);
            }
            "toggle" => {
                let Some(id) = action.payload_as::<String>() else {
                    return;
                };
                let Some(task) = self.tasks.iter_mut().find(|t| t.id == id) else {
                    return;
                };
                if let Some(done) = action
                    .signal(&format!("done.{id}"))
                    .and_then(Value::as_bool)
                {
                    task.done = done;
                }
                out.signal(json!({ "done": { &id: task.done } }));
            }
            "delete" => {
                let Some(id) = action.payload_as::<String>() else {
                    return;
                };
                let Some(i) = self.tasks.iter().position(|t| t.id == id) else {
                    return;
                };
                self.tasks.remove(i);
                out.remove(id.as_str());
                out.signal(json!({ "done": { &id: null } }));
            }
            "clear" => {
                let mut patch = Map::new();
                for t in self.tasks.iter().filter(|t| t.done) {
                    out.remove(t.id.as_str());
                    patch.insert(t.id.clone(), Value::Null);
                }
                self.tasks.retain(|t| !t.done);
                out.signal(json!({ "done": patch, "_clearing": false }));
            }
            _ => {}
        }
    }
}

hypereffect::wasm_app!(Todos);
