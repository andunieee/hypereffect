"""A task list: adding, checking off and deleting tasks, a local filter, and
a confirmation dialog. The Python port of the demo on hypereffect.dev."""

from __future__ import annotations

from dataclasses import dataclass

from hypereffect import Action, App, Element, Handler, Json, Outbox, cel, ui


@dataclass
class Task:
    id: str
    title: str
    done: bool


class Todos(App):
    def __init__(self) -> None:
        self.next = 1
        self.tasks = [
            Task(self.new_id(), title, done)
            for title, done in [("Water the plants", True), ("Call the bank", False), ("Read the spec", False)]
        ]

    def new_id(self) -> str:
        id = f"t{self.next}"
        self.next += 1
        return id

    def row(self, task: Task) -> list[Element]:
        id = task.id
        done = f"s.done.{id}"
        return [
            ui.row(id)
            .parent("items")
            .justify("between")
            .visible(cel(f"s._filter == 'all' || (s._filter == 'done') == {done}")),
            ui.checkbox(f"{id}-check")
            .parent(id)
            .label(task.title)
            .bind(f"done.{id}")
            .on_change(Handler(action="toggle", payload=id)),
            ui.button(f"{id}-del")
            .parent(id)
            .label("Delete")
            .variant("plain")
            .on_press(Handler(action="delete", payload=id)),
        ]

    def hello(self, out: Outbox, params: dict[str, str]) -> None:
        out.signal({
            "new": "",
            "done": {t.id: t.done for t in self.tasks},
            "_filter": "all",
            "_adding": False,
            "_confirm": False,
            "_clearing": False,
        })
        out.element(ui.card("todos").title("Tasks"))
        out.element(ui.row("add-row").parent("todos"))
        out.element(
            ui.input("new")
            .parent("add-row")
            .placeholder("New task")
            .bind("new")
            .error(cel("size(s.new) > 80 ? 'Keep it under 80 characters.' : ''"))
            .on_submit(Handler(action="add", indicator="_adding"))
        )
        out.element(
            ui.button("add")
            .parent("add-row")
            .variant("primary")
            .label(cel("s._adding ? 'Adding…' : 'Add'"))
            .disabled(cel("s._adding || s.new.trim() == '' || size(s.new) > 80"))
            .on_press(Handler(action="add", indicator="_adding"))
        )
        out.element(
            ui.select("filter")
            .parent("todos")
            .variant("segmented")
            .bind("_filter")
            .options([
                {"value": "all", "label": "All"},
                {"value": "open", "label": "Open"},
                {"value": "done", "label": "Done"},
            ])
        )
        out.element(ui.list("items").parent("todos").empty("Nothing here."))
        for t in self.tasks:
            for e in self.row(t):
                out.element(e)
        out.element(ui.row("footer").parent("todos").justify("between"))
        out.element(ui.text("left").parent("footer").variant("caption").text(cel(
            "string(s.done.filter(k, !s.done[k]).size()) + ' of ' + string(size(s.done)) + ' left'"
        )))
        out.element(
            ui.button("clear")
            .parent("footer")
            .variant("failure")
            .label("Clear completed…")
            .disabled(cel("!s.done.exists(k, s.done[k]) || s._clearing"))
            .on_press(Handler(patch={"_confirm": True}))
        )
        out.element(
            ui.dialog("confirm")
            .title("Clear completed tasks?")
            .open(cel("s._confirm"))
            .on_dismiss(Handler(patch={"_confirm": False}))
        )
        out.element(ui.text("confirm-text").parent("confirm").text(cel(
            "string(s.done.filter(k, s.done[k]).size()) + ' tasks will be deleted.'"
        )))
        out.element(ui.row("confirm-row").parent("confirm").justify("end"))
        out.element(
            ui.button("confirm-no")
            .parent("confirm-row")
            .label("Cancel")
            .on_press(Handler(patch={"_confirm": False}))
        )
        out.element(
            ui.button("confirm-yes")
            .parent("confirm-row")
            .variant("failure")
            .label("Delete")
            .on_press(Handler(action="clear", patch={"_confirm": False}, indicator="_clearing"))
        )

    def find(self, id: Json) -> Task | None:
        return next((t for t in self.tasks if t.id == id), None)

    def action(self, out: Outbox, action: Action) -> None:
        if action.name == "add":
            raw = action.signal("new")
            title = raw.strip() if isinstance(raw, str) else ""
            if not title or len(title) > 80:
                out.signal({"_adding": False})
                return
            task = Task(self.new_id(), title, False)
            # New tasks go at the top.
            first = self.tasks[0].id if self.tasks else None
            # The signal comes first so that the row's expressions can read
            # done.<id> as soon as it arrives.
            out.signal({"new": "", "done": {task.id: False}, "_adding": False})
            for i, e in enumerate(self.row(task)):
                out.element(e.before(first) if i == 0 and first else e)
            self.tasks.insert(0, task)
        elif action.name == "toggle":
            task = self.find(action.payload)
            if task is None:
                return
            done = action.signal(f"done.{task.id}")
            if isinstance(done, bool):
                task.done = done
            out.signal({"done": {task.id: task.done}})
        elif action.name == "delete":
            task = self.find(action.payload)
            if task is None:
                return
            self.tasks.remove(task)
            out.remove(task.id)
            out.signal({"done": {task.id: None}})
        elif action.name == "clear":
            for t in self.tasks:
                if t.done:
                    out.remove(t.id)
            out.signal({"done": {t.id: None for t in self.tasks if t.done}, "_clearing": False})
            self.tasks = [t for t in self.tasks if not t.done]
