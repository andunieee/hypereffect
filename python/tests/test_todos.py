from examples.todos import Todos
from hypereffect.client import Loopback


def test_add_toggle_delete_clear() -> None:
    l = Loopback(Todos)
    c = l.client
    assert c.children("items") == ["t1", "t2", "t3"]
    assert c.attr("left", "text") == "2 of 3 left"
    assert c.attr("add", "disabled") is True

    l.write("new", "  Buy milk ")
    assert c.attr("add", "disabled") is False
    assert l.trigger("new", "onSubmit")
    assert c.children("items") == ["t4", "t1", "t2", "t3"]
    assert c.attr("t4-check", "label") == "Buy milk"
    assert c.value("new") == ""
    assert c.value("_adding") is False

    # Filters are local: no action, only visibility changes.
    l.write("_filter", "done")
    assert c.attr("t1", "visible") is True
    assert c.attr("t4", "visible") is False
    l.write("_filter", "all")

    l.write("done.t4", True)
    assert l.trigger("t4-check", "onChange")
    assert c.attr("left", "text") == "2 of 4 left"

    assert l.trigger("t2-del", "onPress")
    assert "t2" not in c
    assert "t2-check" not in c
    assert not c.has_value("done.t2")

    assert c.attr("confirm", "open") is False
    assert not l.trigger("clear", "onPress")
    assert c.attr("confirm", "open") is True
    assert c.attr("confirm-text", "text") == "2 tasks will be deleted."
    assert l.trigger("confirm-yes", "onPress")
    assert c.attr("confirm", "open") is False
    assert c.children("items") == ["t3"]
    assert c.attr("clear", "disabled") is True
    assert c.take_diagnostics() == []
