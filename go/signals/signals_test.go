package signals

import (
	"encoding/json"
	"reflect"
	"testing"
)

func decode(s string) any {
	var v any
	if err := json.Unmarshal([]byte(s), &v); err != nil {
		panic(err)
	}
	return v
}

func TestRFC7386Examples(t *testing.T) {
	cases := [][3]string{
		{`{"a":"b"}`, `{"a":"c"}`, `{"a":"c"}`},
		{`{"a":"b"}`, `{"b":"c"}`, `{"a":"b","b":"c"}`},
		{`{"a":"b"}`, `{"a":null}`, `{}`},
		{`{"a":[{"b":"c"}]}`, `{"a":[1]}`, `{"a":[1]}`},
		{`{"a":"foo"}`, `null`, `null`},
		{`{"e":null}`, `{"a":1}`, `{"e":null,"a":1}`},
		{`{}`, `{"a":{"bb":{"ccc":null}}}`, `{"a":{"bb":{}}}`},
		{`{"a":5}`, `{"a":{"b":1}}`, `{"a":{"b":1}}`},
	}
	for _, c := range cases {
		got := MergePatch(decode(c[0]), decode(c[1]))
		if want := decode(c[2]); !reflect.DeepEqual(got, want) {
			t.Errorf("%s + %s = %v, want %v", c[0], c[1], got, want)
		}
	}
}

func TestLocalSignals(t *testing.T) {
	v := decode(`{"a":1,"_b":2,"c":{"_d":3,"e":[{"_f":1,"g":2}]}}`)
	if got, want := StripLocal(v), decode(`{"a":1,"c":{"e":[{"g":2}]}}`); !reflect.DeepEqual(got, want) {
		t.Errorf("got %v", got)
	}
}

func TestPaths(t *testing.T) {
	for s, want := range map[string][]string{
		"form.email": {"form", "email"},
		"_busy":      {"_busy"},
		"a..b":       nil,
		"1a":         nil,
		"":           nil,
	} {
		got, ok := ParsePath(s)
		if ok != (want != nil) || !reflect.DeepEqual(got, want) {
			t.Errorf("ParsePath(%q) = %v, %v", s, got, ok)
		}
	}
	if got := PathPatch([]string{"a", "b"}, 1.0); !reflect.DeepEqual(got, decode(`{"a":{"b":1}}`)) {
		t.Errorf("got %v", got)
	}
}
