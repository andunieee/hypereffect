package todos

import (
	"reflect"
	"testing"

	"github.com/hypereffect/hypereffect/go/client"
)

func TestAddToggleDeleteClear(t *testing.T) {
	l := client.NewLoopback(New)
	c := l.Client
	attr := func(id, name string) any {
		t.Helper()
		v, ok := c.Attr(id, name)
		if !ok {
			t.Fatalf("no attribute %s.%s", id, name)
		}
		return v
	}
	eq := func(got, want any) {
		t.Helper()
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %#v, want %#v", got, want)
		}
	}

	eq(c.Children("items"), []string{"t1", "t2", "t3"})
	eq(attr("left", "text"), "2 of 3 left")
	eq(attr("add", "disabled"), true)

	l.Write("new", "  Buy milk ")
	eq(attr("add", "disabled"), false)
	eq(l.Trigger("new", "onSubmit"), true)
	eq(c.Children("items"), []string{"t4", "t1", "t2", "t3"})
	eq(attr("t4-check", "label"), "Buy milk")
	v, _ := c.Value("new")
	eq(v, "")
	v, _ = c.Value("_adding")
	eq(v, false)

	// Filters are local: no action, only visibility changes.
	l.Write("_filter", "done")
	eq(attr("t1", "visible"), true)
	eq(attr("t4", "visible"), false)
	l.Write("_filter", "all")

	l.Write("done.t4", true)
	eq(l.Trigger("t4-check", "onChange"), true)
	eq(attr("left", "text"), "2 of 4 left")

	eq(l.Trigger("t2-del", "onPress"), true)
	eq(c.Contains("t2"), false)
	eq(c.Contains("t2-check"), false)
	_, ok := c.Value("done.t2")
	eq(ok, false)

	eq(attr("confirm", "open"), false)
	eq(l.Trigger("clear", "onPress"), false)
	eq(attr("confirm", "open"), true)
	eq(attr("confirm-text", "text"), "2 tasks will be deleted.")
	eq(l.Trigger("confirm-yes", "onPress"), true)
	eq(attr("confirm", "open"), false)
	eq(c.Children("items"), []string{"t3"})
	eq(attr("clear", "disabled"), true)
	eq(c.TakeDiagnostics(), []string(nil))
}
