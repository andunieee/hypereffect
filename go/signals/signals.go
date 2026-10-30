// Package signals has merge patch (RFC 7386), local signals and signal
// paths. Values are JSON values as decoded by encoding/json: nil, bool,
// numbers, string, []any and map[string]any.
package signals

import "strings"

// MergePatch applies patch to target as a JSON Merge Patch and returns the
// result. Objects in target are modified in place.
func MergePatch(target, patch any) any {
	var changes [][]string
	return MergePatchTracked(target, patch, nil, &changes)
}

// MergePatchTracked is like MergePatch, and appends every path under path
// whose value may have changed to changes.
func MergePatchTracked(target, patch any, path []string, changes *[][]string) any {
	p, ok := patch.(map[string]any)
	if !ok {
		*changes = append(*changes, clone(path))
		return patch
	}
	obj, ok := target.(map[string]any)
	if !ok {
		if len(path) > 0 {
			*changes = append(*changes, clone(path))
		}
		obj = map[string]any{}
	}
	for k, v := range p {
		sub := append(path, k)
		if v == nil {
			if _, ok := obj[k]; ok {
				delete(obj, k)
				*changes = append(*changes, clone(sub))
			}
			continue
		}
		obj[k] = MergePatchTracked(obj[k], v, sub, changes)
	}
	return obj
}

func clone(path []string) []string {
	return append([]string(nil), path...)
}

// StripLocal copies a value without object members whose keys begin with
// `_`, at any depth, including inside arrays.
func StripLocal(v any) any {
	switch v := v.(type) {
	case map[string]any:
		out := make(map[string]any, len(v))
		for k, x := range v {
			if !strings.HasPrefix(k, "_") {
				out[k] = StripLocal(x)
			}
		}
		return out
	case []any:
		out := make([]any, len(v))
		for i, x := range v {
			out[i] = StripLocal(x)
		}
		return out
	}
	return v
}

// ParsePath splits a signal path such as `form.email` into its segments,
// and reports whether it is a valid path.
func ParsePath(s string) ([]string, bool) {
	segs := strings.Split(s, ".")
	for _, seg := range segs {
		if !validSegment(seg) {
			return nil, false
		}
	}
	return segs, true
}

func validSegment(seg string) bool {
	if seg == "" {
		return false
	}
	for i, c := range []byte(seg) {
		alpha := c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c == '_'
		if !alpha && (i == 0 || c < '0' || c > '9') {
			return false
		}
	}
	return true
}

// PathPatch returns the merge patch that writes value at path.
func PathPatch(path []string, value any) any {
	for i := len(path) - 1; i >= 0; i-- {
		value = map[string]any{path[i]: value}
	}
	return value
}

// GetPath returns the value at path, if there is one.
func GetPath(v any, path []string) (any, bool) {
	for _, k := range path {
		m, ok := v.(map[string]any)
		if !ok {
			return nil, false
		}
		if v, ok = m[k]; !ok {
			return nil, false
		}
	}
	return v, true
}

// Overlaps reports whether a change at one path can affect a read of the
// other.
func Overlaps(a, b []string) bool {
	for i := 0; i < len(a) && i < len(b); i++ {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
