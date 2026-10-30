// Package jsonx has the JSON encoding and decoding the protocol uses: numbers
// decode to json.Number, so that ints and doubles stay apart, and encoding
// does not escape HTML characters.
package jsonx

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
)

// Decode decodes exactly one JSON value, with numbers as json.Number.
func Decode(data []byte, v any) error {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.UseNumber()
	if err := dec.Decode(v); err != nil {
		return err
	}
	if _, err := dec.Token(); err != io.EOF {
		return errors.New("invalid character after top-level value")
	}
	return nil
}

// Marshal encodes v without escaping <, > and &.
func Marshal(v any) ([]byte, error) {
	var b bytes.Buffer
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimSuffix(b.Bytes(), []byte("\n")), nil
}

// MustMarshal is Marshal for values that always encode.
func MustMarshal(v any) []byte {
	b, err := Marshal(v)
	if err != nil {
		panic("hypereffect: cannot encode value: " + err.Error())
	}
	return b
}

// Normalize converts a Go value to its JSON form: nil, bool, json.Number,
// string, []any and map[string]any.
func Normalize(v any) (any, error) {
	switch v.(type) {
	case nil, bool, string, json.Number:
		return v, nil
	}
	b, err := Marshal(v)
	if err != nil {
		return nil, err
	}
	var out any
	err = Decode(b, &out)
	return out, err
}
