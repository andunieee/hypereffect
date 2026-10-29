// Signals: merge patch (RFC 7386), local signals and signal paths.

import type { Json, JsonObject } from './message.ts';

export function isObject(v: unknown): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Applies patch to target as a JSON Merge Patch and returns the result.
// Objects in target are modified in place.
export function mergePatch(target: Json | undefined, patch: Json): Json {
  return mergePatchTracked(target, patch, [], []);
}

// Like mergePatch, and pushes every path under path whose value may have
// changed to changes.
export function mergePatchTracked(target: Json | undefined, patch: Json, path: string[], changes: string[][]): Json {
  if (!isObject(patch)) {
    changes.push([...path]);
    return patch;
  }
  let obj: JsonObject;
  if (isObject(target)) {
    obj = target;
  } else {
    if (path.length) changes.push([...path]);
    obj = {};
  }
  for (const [k, v] of Object.entries(patch)) {
    path.push(k);
    if (v === null) {
      if (Object.hasOwn(obj, k)) {
        delete obj[k];
        changes.push([...path]);
      }
    } else {
      obj[k] = mergePatchTracked(Object.hasOwn(obj, k) ? obj[k] : undefined, v, path, changes);
    }
    path.pop();
  }
  return obj;
}

// Copies a value without object members whose keys begin with `_`, at any
// depth, including inside arrays.
export function stripLocal<T extends Json>(v: T): T {
  if (Array.isArray(v)) return v.map(stripLocal) as T;
  if (isObject(v)) {
    const out: JsonObject = {};
    for (const [k, x] of Object.entries(v)) if (!k.startsWith('_')) out[k] = stripLocal(x);
    return out as T;
  }
  return v;
}

const SEGMENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Splits a signal path such as `form.email` into its segments, or returns
// undefined if it is not a valid path.
export function parsePath(s: string): string[] | undefined {
  const segs = s.split('.');
  return segs.every((x) => SEGMENT.test(x)) ? segs : undefined;
}

// The merge patch that writes value at path.
export function pathPatch(path: readonly string[], value: Json): Json {
  return path.reduceRight<Json>((v, k) => ({ [k]: v }), value);
}

// The value at path, if there is one.
export function getPath(v: Json, path: readonly string[]): Json | undefined {
  let cur: Json | undefined = v;
  for (const k of path) {
    if (!isObject(cur) || !Object.hasOwn(cur, k)) return undefined;
    cur = cur[k];
  }
  return cur;
}

// Whether a change at one path can affect a read of the other.
export function overlaps(a: readonly string[], b: readonly string[]): boolean {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return false;
  return true;
}
