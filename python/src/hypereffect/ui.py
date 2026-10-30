"""Constructors for each component: ``ui.text("title")`` is
``Element("title", Component.TEXT)``."""

from .components import Component
from .message import Element


def column(id: str) -> Element:
    return Element(id, Component.COLUMN)


def row(id: str) -> Element:
    return Element(id, Component.ROW)


def card(id: str) -> Element:
    return Element(id, Component.CARD)


def list(id: str) -> Element:
    return Element(id, Component.LIST)


def tabs(id: str) -> Element:
    return Element(id, Component.TABS)


def tab(id: str) -> Element:
    return Element(id, Component.TAB)


def dialog(id: str) -> Element:
    return Element(id, Component.DIALOG)


def text(id: str) -> Element:
    return Element(id, Component.TEXT)


def notice(id: str) -> Element:
    return Element(id, Component.NOTICE)


def badge(id: str) -> Element:
    return Element(id, Component.BADGE)


def image(id: str) -> Element:
    return Element(id, Component.IMAGE)


def divider(id: str) -> Element:
    return Element(id, Component.DIVIDER)


def progress(id: str) -> Element:
    return Element(id, Component.PROGRESS)


def button(id: str) -> Element:
    return Element(id, Component.BUTTON)


def input(id: str) -> Element:
    return Element(id, Component.INPUT)


def checkbox(id: str) -> Element:
    return Element(id, Component.CHECKBOX)


def select(id: str) -> Element:
    return Element(id, Component.SELECT)


def slider(id: str) -> Element:
    return Element(id, Component.SLIDER)
