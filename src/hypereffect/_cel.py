"""CEL for hypereffect, on top of cel-python: the environment of spec section
9.1 (the variable ``s``, the standard definitions and the strings, math and
lists extensions), and JSON conversion (9.2).

cel-python provides the standard definitions, except that it compares ints
and doubles only within a type. This module adds cross-type numeric
comparison, the strings, math and lists extensions (following cel-go), the
``sortBy`` macro, and the ``math.``, ``strings.`` and ``lists.`` namespaces.
"""

from __future__ import annotations

import math
import re
from collections.abc import Callable
from functools import cmp_to_key
from typing import Any

import celpy
import lark
from celpy import celtypes as t
from celpy.adapter import json_to_cel
from celpy.evaluation import CELEvalError, Evaluator, base_functions

from .message import Json


class CelError(Exception):
    pass


def _fail(msg: str) -> CELEvalError:
    return CELEvalError(msg, ValueError, (msg,))


INT_MIN = -(2**63)
INT_MAX = 2**63 - 1
UINT_MAX = 2**64 - 1

def _is_number(x: Any) -> bool:
    return type_name(x) in ("int", "uint", "double")


def _native(x: Any) -> Any:
    """A number as a plain int or float: cel-python's types refuse to
    compare across types."""
    return float(x) if isinstance(x, t.DoubleType) else int(x)


def type_name(v: Any) -> str:
    """The CEL type of a value. cel-python returns some results as plain
    Python values (str, list, dict), which count as their CEL types."""
    if v is None:
        return "null_type"
    if isinstance(v, (bool, t.BoolType)):
        return "bool"
    if isinstance(v, t.UintType):
        return "uint"
    if isinstance(v, int):
        return "int"
    if isinstance(v, float):
        return "double"
    if isinstance(v, str):
        return "string"
    if isinstance(v, bytes):
        return "bytes"
    if isinstance(v, list):
        return "list"
    if isinstance(v, dict):
        return "map"
    return type(v).__name__


def lift(v: Any) -> Any:
    """A value with plain Python parts converted to cel-python's types."""
    match type_name(v):
        case "bool":
            return t.BoolType(v)
        case "int":
            return t.IntType(v)
        case "double":
            return t.DoubleType(v)
        case "string":
            return t.StringType(v)
        case "list":
            return t.ListType(lift(x) for x in v)
        case "map":
            return t.MapType({lift(k): lift(x) for k, x in v.items()})
    return v


# --- equality and ordering ---------------------------------------------------


def equals(a: Any, b: Any) -> bool:
    """CEL equality: numbers by value across types, lists and maps by
    contents, values of different types unequal."""
    if _is_number(a) and _is_number(b):
        return bool(_native(a) == _native(b))  # NaN is unequal; int and float compare exactly
    if type_name(a) != type_name(b):
        return False
    if isinstance(a, list):
        return len(a) == len(b) and all(equals(x, y) for x, y in zip(a, b))
    if isinstance(a, dict):
        return len(a) == len(b) and all(
            any(equals(k, k2) and equals(v, b[k2]) for k2 in b) for k, v in a.items()
        )
    return bool(a == b)


def _compare(a: Any, b: Any) -> int:
    """Orders two values of comparable types: numbers of any type by value,
    strings, bools, bytes. Raises TypeError otherwise."""
    if _is_number(a) and _is_number(b):
        a, b = _native(a), _native(b)
        if (isinstance(a, float) and math.isnan(a)) or (isinstance(b, float) and math.isnan(b)):
            raise TypeError("cannot compare NaN")
    elif type_name(a) != type_name(b) or type_name(a) not in ("string", "bool", "bytes"):
        raise TypeError(f"cannot compare {type_name(a)} and {type_name(b)}")
    return int((a > b) - (a < b))


def _relation(test: Callable[[int], bool]) -> Callable[[Any, Any], Any]:
    def op(a: Any, b: Any) -> Any:
        if isinstance(a, CELEvalError):
            return a
        if isinstance(b, CELEvalError):
            return b
        try:
            return t.BoolType(test(_compare(a, b)))
        except TypeError as e:
            return _fail(f"no such overload: {e}")

    return op


def _eq(a: Any, b: Any) -> Any:
    if isinstance(a, CELEvalError):
        return a
    if isinstance(b, CELEvalError):
        return b
    return t.BoolType(equals(a, b))


def _ne(a: Any, b: Any) -> Any:
    r = _eq(a, b)
    return r if isinstance(r, CELEvalError) else t.BoolType(not r)


def _in(item: Any, container: Any) -> Any:
    if isinstance(container, list):
        return t.BoolType(any(equals(item, x) for x in container))
    if isinstance(container, dict):
        return t.BoolType(any(equals(item, k) for k in container))
    return _fail(f"no such overload: in {type_name(container)}")


def _div(a: Any, b: Any) -> Any:
    if isinstance(a, float) and isinstance(b, float) and float(b) == 0.0:
        x, y = float(a), float(b)
        if x == 0.0 or math.isnan(x):
            return t.DoubleType(math.nan)
        return t.DoubleType(math.copysign(math.inf, x) * math.copysign(1.0, y))
    return base_functions["_/_"](a, b)


# --- functions ---------------------------------------------------------------
#
# Methods take the receiver first. Names shared by several receiver types
# dispatch on it. Each returns a CEL value or a CELEvalError.

FUNCTIONS: dict[str, Callable[..., Any]] = {}


def _function(name: str) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    def register(f: Callable[..., Any]) -> Callable[..., Any]:
        def wrapped(*args: Any) -> Any:
            try:
                return f(*args)
            except CELEvalError as e:
                return e
            except (TypeError, ValueError, IndexError, KeyError, OverflowError) as e:
                return _fail(f"{name}: {e}")

        FUNCTIONS[name] = wrapped
        return f

    return register


def _int(v: int) -> t.IntType:
    if not INT_MIN <= v <= INT_MAX:
        raise _fail("int overflow")
    return t.IntType(v)


def _expect(v: Any, types: str, what: str) -> None:
    """Fails unless v has one of the CEL types named in ``types``."""
    if type_name(v) not in types.split():
        raise _fail(f"expected {what}, got {type_name(v)}")


# --- strings


@_function("charAt")
def _char_at(s: Any, i: Any) -> Any:
    _expect(s, "string", "a string")
    if not 0 <= i <= len(s):
        raise _fail("charAt: index out of range")
    return t.StringType(s[i : i + 1])


@_function("indexOf")
def _index_of(s: Any, sub: Any, start: Any = 0) -> Any:
    _expect(s, "string", "a string")
    if not 0 <= start <= len(s):
        raise _fail("indexOf: index out of range")
    return t.IntType(s.find(sub, start))


@_function("lastIndexOf")
def _last_index_of(s: Any, sub: Any, end: Any = None) -> Any:
    _expect(s, "string", "a string")
    if end is None:
        return t.IntType(s.rfind(sub))
    if not 0 <= end <= len(s):
        raise _fail("lastIndexOf: index out of range")
    return t.IntType(s.rfind(sub, 0, end + len(sub)))


@_function("lowerAscii")
def _lower_ascii(s: Any) -> Any:
    _expect(s, "string", "a string")
    return t.StringType("".join(c.lower() if c.isascii() else c for c in s))


@_function("upperAscii")
def _upper_ascii(s: Any) -> Any:
    _expect(s, "string", "a string")
    return t.StringType("".join(c.upper() if c.isascii() else c for c in s))


@_function("replace")
def _replace(s: Any, old: Any, new: Any, n: Any = -1) -> Any:
    _expect(s, "string", "a string")
    return t.StringType(s.replace(old, new, n if n >= 0 else -1))


@_function("split")
def _split(s: Any, sep: Any, n: Any = -1) -> Any:
    _expect(s, "string", "a string")
    if n == 0:
        return t.ListType([])
    parts = list(s) if sep == "" else s.split(sep)
    if n > 0 and len(parts) > n:
        rest = parts[n - 1 :]
        parts = parts[: n - 1] + [sep.join(rest)]
    return t.ListType([t.StringType(p) for p in parts])


@_function("substring")
def _substring(s: Any, start: Any, end: Any = None) -> Any:
    _expect(s, "string", "a string")
    end = len(s) if end is None else end
    if not 0 <= start <= end <= len(s):
        raise _fail("substring: index out of range")
    return t.StringType(s[start:end])


@_function("trim")
def _trim(s: Any) -> Any:
    _expect(s, "string", "a string")
    return t.StringType(s.strip())


@_function("join")
def _join(items: Any, sep: Any = "") -> Any:
    _expect(items, "list", "a list")
    for x in items:
        _expect(x, "string", "a list of strings")
    return t.StringType(sep.join(items))


@_function("reverse")
def _reverse(v: Any) -> Any:
    if isinstance(v, str):
        return t.StringType(v[::-1])
    _expect(v, "list", "a string or a list")
    return t.ListType(reversed(v))


def _format_double(d: float) -> str:
    if math.isnan(d):
        return "NaN"
    if math.isinf(d):
        return "+Inf" if d > 0 else "-Inf"
    # As JavaScript's String(): integral values without a fraction.
    return str(int(d)) if d.is_integer() and abs(d) < 1e21 else repr(d)


def _to_str(x: Any) -> str:
    if x is None:
        return "null"
    kind = type_name(x)
    if kind == "bool":
        return "true" if x else "false"
    if kind == "string":
        return str(x)
    if kind in ("int", "uint"):
        return str(int(x))
    if kind == "double":
        return _format_double(float(x))
    if kind == "list":
        return "[" + ", ".join(_display(v) for v in x) + "]"
    if kind == "map":
        return "{" + ", ".join(f"{_display(k)}: {_display(v)}" for k, v in x.items()) + "}"
    raise _fail(f"format: cannot format {type_name(x)}")


def _display(v: Any) -> str:
    return _quote(v) if isinstance(v, str) else _to_str(v)


_ESCAPES = {
    "\\": "\\\\", '"': '\\"', "\n": "\\n", "\r": "\\r", "\t": "\\t",
    "\b": "\\b", "\f": "\\f", "\v": "\\v", "\x07": "\\a",
}


def _quote(s: str) -> str:
    def esc(m: re.Match[str]) -> str:
        c = m.group(0)
        return _ESCAPES.get(c, f"\\x{ord(c):02x}")

    return '"' + re.sub(r'[\\"\x00-\x1f\x7f]', esc, s) + '"'


def _integer(a: Any, verb: str) -> int:
    if type_name(a) in ("int", "uint"):
        return int(a)
    raise _fail(f"format: %{verb} requires an integer")


@_function("format")
def _format(s: Any, args: Any) -> Any:
    _expect(s, "string", "a string")
    _expect(args, "list", "a list")
    i = 0

    def verb(m: re.Match[str]) -> str:
        nonlocal i
        prec, v = m.group(1), m.group(2)
        if v == "%":
            return "%"
        if i >= len(args):
            raise _fail("format: not enough arguments")
        a = args[i]
        i += 1
        p = 6 if prec is None else int(prec)
        if v == "s":
            return _to_str(a)
        if v == "d":
            return str(_integer(a, v))
        if v in "feE":
            d = float(a) if isinstance(a, float) else float(_integer(a, v))
            if not math.isfinite(d):
                return _format_double(d)
            return f"{d:.{p}{v}}"
        if v in "xX":
            if isinstance(a, str):
                h = a.encode().hex()
            elif isinstance(a, bytes):
                h = bytes(a).hex()
            else:
                n = _integer(a, v)
                h = ("-" if n < 0 else "") + format(abs(n), "x")
            return h.upper() if v == "X" else h
        if v == "o":
            return format(_integer(a, v), "o")
        if v == "b":
            if type_name(a) == "bool":
                return "true" if a else "false"
            return format(_integer(a, v), "b")
        if v == "c":
            return chr(_integer(a, v))
        return m.group(0)

    return t.StringType(re.sub(r"%(?:\.(\d+))?([sdfeExXobc%])", verb, s))


# --- math


def _extreme(name: str, args: tuple[Any, ...], sign: int) -> Any:
    items = list(args[0]) if len(args) == 1 and isinstance(args[0], list) else list(args)
    if not items:
        raise _fail(f"math.{name}: no arguments")
    best = items[0]
    for x in items:
        if not _is_number(x):
            raise _fail(f"math.{name}: {type_name(x)} is not a number")
        if _compare(x, best) * sign > 0:
            best = x
    return best


def _double(x: Any) -> float:
    _expect(x, "double", "a double")
    return float(x)


def _round(x: float) -> float:
    if not math.isfinite(x):
        return x
    return math.copysign(math.floor(abs(x) + 0.5), x)


def _abs(x: Any) -> Any:
    if isinstance(x, float):
        return t.DoubleType(abs(x))
    if isinstance(x, t.UintType):
        return x
    _expect(x, "int", "a number")
    return _int(abs(x))


def _sign(x: Any) -> Any:
    if isinstance(x, float):
        return x if math.isnan(x) else t.DoubleType((x > 0) - (x < 0))
    if isinstance(x, t.UintType):
        return t.UintType(1 if x else 0)
    _expect(x, "int", "a number")
    return t.IntType((x > 0) - (x < 0))


def _sqrt(x: Any) -> Any:
    if not _is_number(x):
        raise _fail(f"expected a number, got {type_name(x)}")
    return t.DoubleType(math.sqrt(x) if x >= 0 else math.nan)


def _bits(op: Callable[[int, int], int]) -> Callable[[Any, Any], Any]:
    def f(a: Any, b: Any) -> Any:
        if isinstance(a, t.UintType) and isinstance(b, t.UintType):
            return t.UintType(op(a, b) & UINT_MAX)
        _expect(a, "int", "two ints or two uints")
        _expect(b, "int", "two ints or two uints")
        return t.IntType(_wrap64(op(a, b)))

    return f


def _wrap64(v: int) -> int:
    v &= UINT_MAX
    return v - 2**64 if v > INT_MAX else v


def _bit_not(a: Any) -> Any:
    if isinstance(a, t.UintType):
        return t.UintType(~a & UINT_MAX)
    _expect(a, "int", "an int or a uint")
    return t.IntType(~a)


def _shift(left: bool) -> Callable[[Any, Any], Any]:
    def f(a: Any, n: Any) -> Any:
        _expect(n, "int", "an int offset")
        if n < 0:
            raise _fail("negative offset")
        if n > 63:
            return t.UintType(0) if isinstance(a, t.UintType) else t.IntType(0)
        if isinstance(a, t.UintType):
            return t.UintType(((a << n) if left else (a >> n)) & UINT_MAX)
        _expect(a, "int", "an int or a uint")
        # The right shift is logical, also for int.
        return t.IntType(_wrap64((a << n) if left else ((a & UINT_MAX) >> n)))

    return f


MATH: dict[str, Callable[..., Any]] = {
    "greatest": lambda *a: _extreme("greatest", a, 1),
    "least": lambda *a: _extreme("least", a, -1),
    "ceil": lambda x: t.DoubleType(math.ceil(_double(x)) if math.isfinite(x) else x),
    "floor": lambda x: t.DoubleType(math.floor(_double(x)) if math.isfinite(x) else x),
    "round": lambda x: t.DoubleType(_round(_double(x))),
    "trunc": lambda x: t.DoubleType(math.trunc(_double(x)) if math.isfinite(x) else x),
    "isInf": lambda x: t.BoolType(math.isinf(_double(x))),
    "isNaN": lambda x: t.BoolType(math.isnan(_double(x))),
    "isFinite": lambda x: t.BoolType(math.isfinite(_double(x))),
    "abs": _abs,
    "sign": _sign,
    "sqrt": _sqrt,
    "bitAnd": _bits(lambda a, b: a & b),
    "bitOr": _bits(lambda a, b: a | b),
    "bitXor": _bits(lambda a, b: a ^ b),
    "bitNot": _bit_not,
    "bitShiftLeft": _shift(True),
    "bitShiftRight": _shift(False),
}


# --- lists


def _range(n: Any) -> Any:
    _expect(n, "int", "an int")
    return t.ListType(t.IntType(i) for i in range(n))


@_function("slice")
def _slice(items: Any, start: Any, end: Any) -> Any:
    _expect(items, "list", "a list")
    if start < 0 or end < 0:
        raise _fail("slice: negative index")
    if start > end:
        raise _fail(f"slice: start index {start} is greater than end index {end}")
    if end > len(items):
        raise _fail(f"slice: end index {end} is out of range")
    return t.ListType(items[start:end])


def _flatten_into(items: Any, depth: int, out: list[Any]) -> None:
    for x in items:
        if isinstance(x, list) and depth > 0:
            _flatten_into(x, depth - 1, out)
        else:
            out.append(x)


@_function("flatten")
def _flatten(items: Any, depth: Any = 1) -> Any:
    _expect(items, "list", "a list")
    if depth < 0:
        raise _fail("flatten: level must be non-negative")
    out: list[Any] = []
    _flatten_into(items, depth, out)
    return t.ListType(out)


@_function("distinct")
def _distinct(items: Any) -> Any:
    _expect(items, "list", "a list")
    out: list[Any] = []
    for x in items:
        if not any(equals(x, y) for y in out):
            out.append(x)
    return t.ListType(out)


def _sorted(items: list[Any], keys: list[Any]) -> Any:
    for k in keys[1:]:
        if type_name(k) != type_name(keys[0]) and not (_is_number(k) and _is_number(keys[0])):
            raise _fail("sort: items must be of the same type")
    def by_key(p: tuple[Any, Any], q: tuple[Any, Any]) -> int:
        return _compare(p[0], q[0])

    pairs = sorted(zip(keys, items), key=cmp_to_key(by_key))
    return t.ListType(x for _, x in pairs)


@_function("sort")
def _sort(items: Any) -> Any:
    _expect(items, "list", "a list")
    return _sorted(list(items), list(items))


NAMESPACES: dict[str, dict[str, Callable[..., Any]]] = {
    "math": MATH,
    "strings": {"quote": lambda s: t.StringType(_quote(s))},
    "lists": {"range": _range},
}


# --- the evaluator -----------------------------------------------------------


def _namespace(member: lark.Tree[Any]) -> str | None:
    """The namespace a call's receiver names, if it is a bare identifier
    such as ``math``."""
    node: Any = member
    for data in ("member", "primary", "ident"):
        if not isinstance(node, lark.Tree) or node.data != data or len(node.children) != 1:
            return None
        node = node.children[0]
    return str(node) if str(node) in NAMESPACES else None


class _Evaluator(Evaluator):
    def sub_evaluator(self, ast: lark.Tree[Any]) -> Evaluator:
        return _Evaluator(ast, activation=self.activation)

    def member_dot_arg(self, tree: lark.Tree[Any]) -> Any:
        member_tree, name = tree.children[:2]
        ns = _namespace(member_tree)
        if ns is not None:
            f = NAMESPACES[ns].get(str(name))
            if f is None:
                return _fail(f"undeclared reference to '{ns}.{name}'")
            args = self.visit(tree.children[2]) if len(tree.children) > 2 else []
            for a in args:
                if isinstance(a, CELEvalError):
                    return a
            try:
                return f(*args)
            except CELEvalError as e:
                return e
            except (TypeError, ValueError, OverflowError) as e:
                return _fail(f"{ns}.{name}: {e}")
        if str(name) == "sortBy":
            items = self.visit(member_tree)
            if isinstance(items, CELEvalError):
                return items
            if not isinstance(items, list):
                return _fail("sortBy: receiver is not a list")
            key = self.build_macro_eval(tree)
            try:
                return _sorted(list(items), [key(x) for x in items])
            except CELEvalError as e:
                return e
        return super().member_dot_arg(tree)


class _Runner(celpy.InterpretedRunner):
    def evaluate(self, context: Any) -> Any:
        return _Evaluator(ast=self.ast, activation=self.new_activation()).evaluate(context)


_ENV = celpy.Environment(runner_class=_Runner)
_FUNCTIONS = {
    **FUNCTIONS,
    "_==_": _eq,
    "_!=_": _ne,
    "_<_": _relation(lambda c: c < 0),
    "_<=_": _relation(lambda c: c <= 0),
    "_>_": _relation(lambda c: c > 0),
    "_>=_": _relation(lambda c: c >= 0),
    "_in_": _in,
    "_/_": _div,
}


class Program:
    """An expression compiled once, for repeated evaluation against signals
    in their CEL representation (see :func:`from_json`)."""

    def __init__(self, src: str) -> None:
        try:
            self._runner = _ENV.program(_ENV.compile(src), functions=_FUNCTIONS)
        except Exception as e:
            raise CelError(str(e)) from None

    def eval(self, signals: Any) -> Any:
        try:
            return lift(self._runner.evaluate({"s": signals}))
        except CELEvalError as e:
            raise CelError(e.args[0] if e.args else str(e)) from None
        except Exception as e:  # cel-python lets some errors escape
            raise CelError(str(e)) from None


def compile(src: str) -> Program:
    """Compiles an expression. Raises CelError."""
    return Program(src)


# --- JSON conversion (spec section 9.2) --------------------------------------


def from_json(v: Json) -> Any:
    return json_to_cel(v)


def to_json(v: Any) -> Json:
    """Converts a CEL value to JSON, for a handler's patch. Raises CelError."""
    kind = type_name(v)
    if kind == "null_type":
        return None
    if kind == "bool":
        return bool(v)
    if kind in ("int", "uint"):
        return int(v)
    if kind == "double":
        if not math.isfinite(v):
            raise CelError("no JSON representation for a non-finite double")
        return float(v)
    if kind == "string":
        return str(v)
    if kind == "list":
        return [to_json(x) for x in v]
    if kind == "map":
        out: dict[str, Json] = {}
        for k, x in v.items():
            if not isinstance(k, str):
                raise CelError("map key is not a string")
            out[str(k)] = to_json(x)
        return out
    raise CelError(f"no JSON representation for {type_name(v)}")


__all__ = ["CelError", "Program", "compile", "from_json", "to_json", "type_name", "equals", "lift"]
