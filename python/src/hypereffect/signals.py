"""Signals: merge patch (RFC 7386), local signals and signal paths."""

from __future__ import annotations

import re
from collections.abc import Sequence
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .message import Json


def merge_patch(target: Json, patch: Json) -> Json:
    """Applies ``patch`` to ``target`` as a JSON Merge Patch and returns the
    result. Objects in ``target`` are modified in place."""
    return merge_patch_tracked(target, patch, [], [])


def merge_patch_tracked(target: Json, patch: Json, path: list[str], changes: list[list[str]]) -> Json:
    """Like :func:`merge_patch`, and appends every path under ``path`` whose
    value may have changed to ``changes``."""
    if not isinstance(patch, dict):
        changes.append(list(path))
        return patch
    if isinstance(target, dict):
        obj = target
    else:
        if path:
            changes.append(list(path))
        obj = {}
    for k, v in patch.items():
        path.append(k)
        if v is None:
            if k in obj:
                del obj[k]
                changes.append(list(path))
        else:
            obj[k] = merge_patch_tracked(obj.get(k), v, path, changes)
        path.pop()
    return obj


def strip_local(v: Json) -> Json:
    """Copies a value without object members whose keys begin with ``_``, at
    any depth, including inside arrays."""
    if isinstance(v, dict):
        return {k: strip_local(x) for k, x in v.items() if not k.startswith("_")}
    if isinstance(v, list):
        return [strip_local(x) for x in v]
    return v


_SEGMENT = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


def parse_path(s: str) -> list[str] | None:
    """Splits a signal path such as ``form.email`` into its segments, or
    returns None if it is not a valid path."""
    segs = s.split(".")
    return segs if all(_SEGMENT.fullmatch(x) for x in segs) else None


def path_patch(path: Sequence[str], value: Json) -> Json:
    """The merge patch that writes ``value`` at ``path``."""
    for k in reversed(path):
        value = {k: value}
    return value


_MISSING = object()


def get_path(v: Json, path: Sequence[str], default: Json = None) -> Json:
    """The value at ``path``, or ``default`` if there is none."""
    cur: object = v
    for k in path:
        if not isinstance(cur, dict):
            return default
        cur = cur.get(k, _MISSING)
        if cur is _MISSING:
            return default
    return cur  # type: ignore[return-value]


def has_path(v: Json, path: Sequence[str]) -> bool:
    return get_path(v, path, _MISSING) is not _MISSING  # type: ignore[arg-type]


def overlaps(a: Sequence[str], b: Sequence[str]) -> bool:
    """Whether a change at one path can affect a read of the other."""
    return all(x == y for x, y in zip(a, b))
