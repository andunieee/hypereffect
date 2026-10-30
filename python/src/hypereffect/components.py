"""The eighteen components, their attributes and the nesting rules."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Any


class Component(StrEnum):
    COLUMN = "column"
    ROW = "row"
    CARD = "card"
    LIST = "list"
    TABS = "tabs"
    TAB = "tab"
    DIALOG = "dialog"
    TEXT = "text"
    NOTICE = "notice"
    BADGE = "badge"
    IMAGE = "image"
    DIVIDER = "divider"
    PROGRESS = "progress"
    BUTTON = "button"
    INPUT = "input"
    CHECKBOX = "checkbox"
    SELECT = "select"
    SLIDER = "slider"

    @property
    def attrs(self) -> tuple[Attr, ...]:
        """The attributes of this component other than ``id``, ``type``,
        ``parent`` and ``before``, including ``visible`` and, for controls,
        ``disabled``."""
        return _ATTRS[self]

    def attr(self, name: str) -> Attr | None:
        return next((a for a in _ATTRS[self] if a.name == name), None)

    @property
    def is_control(self) -> bool:
        """Whether this component has a ``disabled`` attribute."""
        return self in _CONTROLS

    @property
    def is_container(self) -> bool:
        return self in _CONTAINERS


def accepts(parent: Component | None, child: Component) -> bool:
    """Whether an element of type ``child`` may be placed in ``parent``
    (None for the root)."""
    if parent is None:
        return child != Component.TAB
    if parent == Component.TABS:
        return child == Component.TAB
    return child not in (Component.TAB, Component.DIALOG) and parent.is_container


@dataclass(frozen=True)
class AttrType:
    """The type of an attribute: ``string``, ``bool``, ``number``,
    ``number?`` (a number or null), ``options`` (a list of
    ``{"value": string, "label": string}``), ``enum`` (a string from
    ``values``; others are treated as the default), or the structural
    ``path`` (a signal path) and ``handler``."""

    kind: str
    values: tuple[str, ...] = ()

    @property
    def is_structural(self) -> bool:
        return self.kind in ("path", "handler")


@dataclass(frozen=True)
class Attr:
    name: str
    type: AttrType
    default: Any = None
    # The default is the element's id (the label of a tab).
    default_id: bool = False

    def default_value(self, id: str) -> Any:
        if self.default_id:
            return id
        if self.type.kind == "options":
            return []
        return self.default


def _a(name: str, kind: str, default: Any = None) -> Attr:
    return Attr(name, AttrType(kind), default)


def _enum(name: str, default: str, *values: str) -> Attr:
    return Attr(name, AttrType("enum", values), default)


def _gap(d: str) -> Attr:
    return _enum("gap", d, "none", "small", "medium", "large")


def _align(d: str) -> Attr:
    return _enum("align", d, "start", "center", "end", "stretch")


_VISIBLE = _a("visible", "bool", True)
_DISABLED = _a("disabled", "bool", False)
_BIND = _a("bind", "path")

C = Component
_ATTRS: dict[Component, tuple[Attr, ...]] = {
    C.COLUMN: (_VISIBLE, _gap("medium"), _align("stretch")),
    C.ROW: (_VISIBLE, _gap("small"), _align("center"),
            _enum("justify", "start", "start", "center", "end", "between"), _a("wrap", "bool", False)),
    C.CARD: (_VISIBLE, _a("title", "string"), _gap("medium")),
    C.LIST: (_VISIBLE, _a("empty", "string")),
    C.TABS: (_VISIBLE, _BIND, _a("onChange", "handler")),
    C.TAB: (_VISIBLE, Attr("label", AttrType("string"), default_id=True), _gap("medium")),
    C.DIALOG: (_VISIBLE, _a("open", "bool", True), _a("title", "string"), _a("onDismiss", "handler")),
    C.TEXT: (_VISIBLE, _a("text", "string", ""),
             _enum("variant", "body", "h1", "h2", "h3", "body", "caption", "code")),
    C.NOTICE: (_VISIBLE, _a("title", "string"), _a("text", "string", ""),
               _enum("variant", "info", "info", "success", "warning", "failure")),
    C.BADGE: (_VISIBLE, _a("text", "string", ""),
              _enum("variant", "neutral", "neutral", "info", "success", "warning", "failure")),
    C.IMAGE: (_VISIBLE, _a("src", "string", ""), _a("alt", "string", ""),
              _enum("variant", "inline", "inline", "thumbnail", "avatar", "full")),
    C.DIVIDER: (_VISIBLE,),
    C.PROGRESS: (_VISIBLE, _a("value", "number?"), _a("label", "string"),
                 _enum("variant", "bar", "bar", "spinner")),
    C.BUTTON: (_VISIBLE, _DISABLED, _a("label", "string", ""),
               _enum("variant", "secondary", "primary", "secondary", "plain", "success", "failure"),
               _a("onPress", "handler")),
    C.INPUT: (_VISIBLE, _DISABLED, _BIND, _a("label", "string"), _a("placeholder", "string"),
              _a("error", "string", ""),
              _enum("variant", "text", "text", "multiline", "password", "number", "email"),
              _a("onChange", "handler"), _a("onSubmit", "handler")),
    C.CHECKBOX: (_VISIBLE, _DISABLED, _BIND, _a("label", "string", ""),
                 _enum("variant", "checkbox", "checkbox", "switch"), _a("onChange", "handler")),
    C.SELECT: (_VISIBLE, _DISABLED, _BIND, _a("label", "string"), _a("options", "options"),
               _enum("variant", "dropdown", "dropdown", "radio", "segmented"), _a("onChange", "handler")),
    C.SLIDER: (_VISIBLE, _DISABLED, _BIND, _a("label", "string"), _a("min", "number", 0.0),
               _a("max", "number", 100.0), _a("step", "number", 1.0), _a("onChange", "handler")),
}
_CONTROLS = frozenset({C.BUTTON, C.INPUT, C.CHECKBOX, C.SELECT, C.SLIDER})
_CONTAINERS = frozenset({C.COLUMN, C.ROW, C.CARD, C.LIST, C.TAB, C.DIALOG})
del C
