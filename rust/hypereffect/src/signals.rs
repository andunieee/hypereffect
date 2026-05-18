//! Signals: merge patch (RFC 7386), local signals and signal paths.

use serde_json::{Map, Value};

/// Applies `patch` to `target` as a JSON Merge Patch.
pub fn merge_patch(target: &mut Value, patch: &Value) {
    merge_patch_tracked(target, patch, &mut Vec::new(), &mut Vec::new());
}

/// Like [`merge_patch`], and pushes every path whose value may have changed
/// to `changes`.
pub fn merge_patch_tracked(
    target: &mut Value,
    patch: &Value,
    path: &mut Vec<String>,
    changes: &mut Vec<Vec<String>>,
) {
    let Value::Object(patch) = patch else {
        changes.push(path.clone());
        *target = patch.clone();
        return;
    };
    if !target.is_object() {
        if !path.is_empty() {
            changes.push(path.clone());
        }
        *target = Value::Object(Map::new());
    }
    let Value::Object(obj) = target else {
        unreachable!()
    };
    for (k, v) in patch {
        path.push(k.clone());
        if v.is_null() {
            if obj.remove(k).is_some() {
                changes.push(path.clone());
            }
        } else {
            merge_patch_tracked(
                obj.entry(k.clone()).or_insert(Value::Null),
                v,
                path,
                changes,
            );
        }
        path.pop();
    }
}

/// Copies a value without object members whose keys begin with `_`, at any
/// depth, including inside arrays.
pub fn strip_local(v: &Value) -> Value {
    match v {
        Value::Object(o) => Value::Object(
            o.iter()
                .filter(|(k, _)| !k.starts_with('_'))
                .map(|(k, v)| (k.clone(), strip_local(v)))
                .collect(),
        ),
        Value::Array(a) => Value::Array(a.iter().map(strip_local).collect()),
        v => v.clone(),
    }
}

/// Like [`strip_local`], for the signals object.
pub fn strip_local_map(m: &Map<String, Value>) -> Map<String, Value> {
    m.iter()
        .filter(|(k, _)| !k.starts_with('_'))
        .map(|(k, v)| (k.clone(), strip_local(v)))
        .collect()
}

/// Splits a signal path such as `form.email` into its segments, or returns
/// `None` if it is not a valid path.
pub fn parse_path(s: &str) -> Option<Vec<&str>> {
    let segs: Vec<&str> = s.split('.').collect();
    let valid = |seg: &str| {
        let mut chars = seg.chars();
        matches!(chars.next(), Some(c) if c.is_ascii_alphabetic() || c == '_')
            && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
    };
    segs.iter().all(|s| valid(s)).then_some(segs)
}

/// The merge patch that writes `value` at `path`.
pub fn path_patch<S: AsRef<str>>(path: &[S], value: Value) -> Value {
    path.iter().rev().fold(value, |v, k| {
        let mut m = Map::new();
        m.insert(k.as_ref().to_string(), v);
        Value::Object(m)
    })
}

/// The value at `path`, if there is one.
pub fn get_path<'a, S: AsRef<str>>(v: &'a Value, path: &[S]) -> Option<&'a Value> {
    path.iter()
        .try_fold(v, |v, k| v.as_object()?.get(k.as_ref()))
}

/// Whether a change at one path can affect a read of the other.
pub fn overlaps<A: AsRef<str>, B: AsRef<str>>(a: &[A], b: &[B]) -> bool {
    a.iter().zip(b).all(|(x, y)| x.as_ref() == y.as_ref())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn rfc7386_examples() {
        let cases = [
            (json!({"a":"b"}), json!({"a":"c"}), json!({"a":"c"})),
            (json!({"a":"b"}), json!({"b":"c"}), json!({"a":"b","b":"c"})),
            (json!({"a":"b"}), json!({"a":null}), json!({})),
            (json!({"a":[{"b":"c"}]}), json!({"a":[1]}), json!({"a":[1]})),
            (json!({"a":"foo"}), json!(null), json!(null)),
            (json!({"e":null}), json!({"a":1}), json!({"e":null,"a":1})),
            (
                json!({}),
                json!({"a":{"bb":{"ccc":null}}}),
                json!({"a":{"bb":{}}}),
            ),
            (json!({"a":5}), json!({"a":{"b":1}}), json!({"a":{"b":1}})),
        ];
        for (mut t, p, want) in cases {
            merge_patch(&mut t, &p);
            assert_eq!(t, want);
        }
    }

    #[test]
    fn local_signals() {
        let v = json!({"a":1,"_b":2,"c":{"_d":3,"e":[{"_f":1,"g":2}]}});
        assert_eq!(strip_local(&v), json!({"a":1,"c":{"e":[{"g":2}]}}));
    }

    #[test]
    fn paths() {
        assert_eq!(parse_path("form.email"), Some(vec!["form", "email"]));
        assert_eq!(parse_path("_busy"), Some(vec!["_busy"]));
        assert_eq!(parse_path("a..b"), None);
        assert_eq!(parse_path("1a"), None);
        assert_eq!(parse_path(""), None);
        assert_eq!(path_patch(&["a", "b"], json!(1)), json!({"a":{"b":1}}));
    }
}
