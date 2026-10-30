// Package todos is a task list: adding, checking off and deleting tasks, a
// local filter, and a confirmation dialog. It is the Go port of the demo on
// hypereffect.dev.
package todos

import (
	"fmt"
	"strings"
	"unicode/utf8"

	he "github.com/hypereffect/hypereffect-go"
	"github.com/hypereffect/hypereffect-go/ui"
)

type task struct {
	id    string
	title string
	done  bool
}

type Todos struct {
	tasks []*task
	next  int
}

func New() *Todos {
	t := &Todos{next: 1}
	for _, s := range []struct {
		title string
		done  bool
	}{{"Water the plants", true}, {"Call the bank", false}, {"Read the spec", false}} {
		t.tasks = append(t.tasks, &task{id: t.newID(), title: s.title, done: s.done})
	}
	return t
}

func (t *Todos) newID() string {
	id := fmt.Sprintf("t%d", t.next)
	t.next++
	return id
}

func (t *Todos) row(task *task) []*he.Element {
	id := task.id
	done := "s.done." + id
	return []*he.Element{
		ui.Row(id).
			Parent("items").
			Justify("between").
			Visible(he.Cel(fmt.Sprintf("s._filter == 'all' || (s._filter == 'done') == %s", done))),
		ui.Checkbox(id + "-check").
			Parent(id).
			Label(task.title).
			Bind("done." + id).
			OnChange(he.Do("toggle").WithPayload(id)),
		ui.Button(id + "-del").
			Parent(id).
			Label("Delete").
			Variant("plain").
			OnPress(he.Do("delete").WithPayload(id)),
	}
}

func (t *Todos) doneSignals() map[string]any {
	m := map[string]any{}
	for _, task := range t.tasks {
		m[task.id] = task.done
	}
	return m
}

func (t *Todos) Hello(out *he.Outbox, _ map[string]string) {
	out.Signal(map[string]any{
		"new":       "",
		"done":      t.doneSignals(),
		"_filter":   "all",
		"_adding":   false,
		"_confirm":  false,
		"_clearing": false,
	})
	out.Element(ui.Card("todos").Title("Tasks"))
	out.Element(ui.Row("add-row").Parent("todos"))
	out.Element(ui.Input("new").
		Parent("add-row").
		Placeholder("New task").
		Bind("new").
		Error(he.Cel("size(s.new) > 80 ? 'Keep it under 80 characters.' : ''")).
		OnSubmit(he.Do("add").WithIndicator("_adding")))
	out.Element(ui.Button("add").
		Parent("add-row").
		Variant("primary").
		Label(he.Cel("s._adding ? 'Adding…' : 'Add'")).
		Disabled(he.Cel("s._adding || s.new.trim() == '' || size(s.new) > 80")).
		OnPress(he.Do("add").WithIndicator("_adding")))
	out.Element(ui.Select("filter").
		Parent("todos").
		Variant("segmented").
		Bind("_filter").
		Options([]map[string]string{
			{"value": "all", "label": "All"},
			{"value": "open", "label": "Open"},
			{"value": "done", "label": "Done"},
		}))
	out.Element(ui.List("items").Parent("todos").Empty("Nothing here."))
	for _, task := range t.tasks {
		for _, e := range t.row(task) {
			out.Element(e)
		}
	}
	out.Element(ui.Row("footer").Parent("todos").Justify("between"))
	out.Element(ui.Text("left").Parent("footer").Variant("caption").Text(he.Cel(
		"string(s.done.filter(k, !s.done[k]).size()) + ' of ' + string(size(s.done)) + ' left'")))
	out.Element(ui.Button("clear").
		Parent("footer").
		Variant("failure").
		Label("Clear completed…").
		Disabled(he.Cel("!s.done.exists(k, s.done[k]) || s._clearing")).
		OnPress(he.Patch(map[string]any{"_confirm": true})))
	out.Element(ui.Dialog("confirm").
		Title("Clear completed tasks?").
		Open(he.Cel("s._confirm")).
		OnDismiss(he.Patch(map[string]any{"_confirm": false})))
	out.Element(ui.Text("confirm-text").Parent("confirm").Text(he.Cel(
		"string(s.done.filter(k, s.done[k]).size()) + ' tasks will be deleted.'")))
	out.Element(ui.Row("confirm-row").Parent("confirm").Justify("end"))
	out.Element(ui.Button("confirm-no").
		Parent("confirm-row").
		Label("Cancel").
		OnPress(he.Patch(map[string]any{"_confirm": false})))
	out.Element(ui.Button("confirm-yes").
		Parent("confirm-row").
		Variant("failure").
		Label("Delete").
		OnPress(he.Do("clear").
			WithPatch(map[string]any{"_confirm": false}).
			WithIndicator("_clearing")))
}

func (t *Todos) find(id string) int {
	for i, task := range t.tasks {
		if task.id == id {
			return i
		}
	}
	return -1
}

func (t *Todos) Action(out *he.Outbox, a *he.Action) {
	switch a.Name {
	case "add":
		title := strings.TrimSpace(a.SignalString("new"))
		if title == "" || utf8.RuneCountInString(title) > 80 {
			out.Signal(map[string]any{"_adding": false})
			return
		}
		nt := &task{id: t.newID(), title: title}
		// The signal comes first so that the row's expressions can read
		// done.<id> as soon as it arrives.
		out.Signal(map[string]any{"new": "", "done": map[string]any{nt.id: false}, "_adding": false})
		for i, e := range t.row(nt) {
			// New tasks go at the top.
			if i == 0 && len(t.tasks) > 0 {
				e.Before(t.tasks[0].id)
			}
			out.Element(e)
		}
		t.tasks = append([]*task{nt}, t.tasks...)
	case "toggle":
		var id string
		if a.DecodePayload(&id) != nil {
			return
		}
		i := t.find(id)
		if i < 0 {
			return
		}
		if done, ok := a.Signal("done." + id); ok {
			if b, ok := done.(bool); ok {
				t.tasks[i].done = b
			}
		}
		out.Signal(map[string]any{"done": map[string]any{id: t.tasks[i].done}})
	case "delete":
		var id string
		if a.DecodePayload(&id) != nil {
			return
		}
		i := t.find(id)
		if i < 0 {
			return
		}
		t.tasks = append(t.tasks[:i], t.tasks[i+1:]...)
		out.Remove(id)
		out.Signal(map[string]any{"done": map[string]any{id: nil}})
	case "clear":
		patch := map[string]any{}
		var kept []*task
		for _, task := range t.tasks {
			if task.done {
				out.Remove(task.id)
				patch[task.id] = nil
			} else {
				kept = append(kept, task)
			}
		}
		t.tasks = kept
		out.Signal(map[string]any{"done": patch, "_clearing": false})
	}
}
