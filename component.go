package hypereffect

// Component is the type of an element.
type Component string

const (
	Column   Component = "column"
	Row      Component = "row"
	Card     Component = "card"
	List     Component = "list"
	Tabs     Component = "tabs"
	Tab      Component = "tab"
	Dialog   Component = "dialog"
	Text     Component = "text"
	Notice   Component = "notice"
	Badge    Component = "badge"
	Image    Component = "image"
	Divider  Component = "divider"
	Progress Component = "progress"
	Button   Component = "button"
	Input    Component = "input"
	Checkbox Component = "checkbox"
	Select   Component = "select"
	Slider   Component = "slider"
)

// Components lists the eighteen components.
var Components = []Component{
	Column, Row, Card, List, Tabs, Tab, Dialog, Text, Notice, Badge, Image,
	Divider, Progress, Button, Input, Checkbox, Select, Slider,
}

// Valid reports whether c is one of the components.
func (c Component) Valid() bool {
	_, ok := componentAttrs[c]
	return ok
}

func (c Component) isContainer() bool {
	switch c {
	case Column, Row, Card, List, Tab, Dialog:
		return true
	}
	return false
}

// IsControl reports whether this component has a `disabled` attribute.
func (c Component) IsControl() bool {
	switch c {
	case Button, Input, Checkbox, Select, Slider:
		return true
	}
	return false
}

// Attrs returns the attributes of this component other than `id`, `type`,
// `parent` and `before`, including `visible` and, for controls, `disabled`.
func (c Component) Attrs() []Attr {
	return componentAttrs[c]
}

// Attr returns the attribute with this name.
func (c Component) Attr(name string) (Attr, bool) {
	for _, a := range componentAttrs[c] {
		if a.Name == name {
			return a, true
		}
	}
	return Attr{}, false
}

// Accepts reports whether an element of type child may be placed in parent
// ("" for the root).
func Accepts(parent, child Component) bool {
	switch parent {
	case "":
		return child != Tab
	case Tabs:
		return child == Tab
	}
	return child != Tab && child != Dialog && parent.isContainer()
}

// AttrKind is the kind of value an attribute holds.
type AttrKind int

const (
	AttrString AttrKind = iota
	AttrBool
	AttrNumber
	AttrNumberOrNull
	// AttrEnum is a string from a fixed set. Unknown values are treated as
	// the default.
	AttrEnum
	// AttrOptions is a list of {"value": string, "label": string}.
	AttrOptions
	// AttrPath is a signal path. Structural.
	AttrPath
	// AttrHandler is a handler object. Structural.
	AttrHandler
)

// AttrType is the type of an attribute: its kind, and for an enum, the
// values.
type AttrType struct {
	Kind   AttrKind
	Values []string
}

// IsStructural reports whether values of this type must be literals.
func (t AttrType) IsStructural() bool {
	return t.Kind == AttrPath || t.Kind == AttrHandler
}

// Attr describes one attribute of a component.
type Attr struct {
	Name string
	Type AttrType
	// Default is the value of an absent attribute, unless DefaultID is set.
	Default any
	// DefaultID means the default is the element's id (the label of a tab).
	DefaultID bool
}

// DefaultValue returns the default for an element with this id.
func (a Attr) DefaultValue(id string) any {
	if a.DefaultID {
		return id
	}
	if a.Type.Kind == AttrOptions {
		return []any{}
	}
	return a.Default
}

func attr(name string, kind AttrKind, def any) Attr {
	return Attr{Name: name, Type: AttrType{Kind: kind}, Default: def}
}

func enum(name string, def string, values ...string) Attr {
	return Attr{Name: name, Type: AttrType{Kind: AttrEnum, Values: values}, Default: def}
}

var componentAttrs = func() map[Component][]Attr {
	gap := func(def string) Attr { return enum("gap", def, "none", "small", "medium", "large") }
	align := func(def string) Attr { return enum("align", def, "start", "center", "end", "stretch") }
	visible := attr("visible", AttrBool, true)
	disabled := attr("disabled", AttrBool, false)
	bind := attr("bind", AttrPath, nil)
	handler := func(name string) Attr { return attr(name, AttrHandler, nil) }
	str := func(name string, def any) Attr { return attr(name, AttrString, def) }
	return map[Component][]Attr{
		Column: {visible, gap("medium"), align("stretch")},
		Row: {visible, gap("small"), align("center"),
			enum("justify", "start", "start", "center", "end", "between"),
			attr("wrap", AttrBool, false)},
		Card: {visible, str("title", nil), gap("medium")},
		List: {visible, str("empty", nil)},
		Tabs: {visible, bind, handler("onChange")},
		Tab:  {visible, {Name: "label", Type: AttrType{Kind: AttrString}, DefaultID: true}, gap("medium")},
		Dialog: {visible, attr("open", AttrBool, true), str("title", nil),
			handler("onDismiss")},
		Text: {visible, str("text", ""),
			enum("variant", "body", "h1", "h2", "h3", "body", "caption", "code")},
		Notice: {visible, str("title", nil), str("text", ""),
			enum("variant", "info", "info", "success", "warning", "failure")},
		Badge: {visible, str("text", ""),
			enum("variant", "neutral", "neutral", "info", "success", "warning", "failure")},
		Image: {visible, str("src", ""), str("alt", ""),
			enum("variant", "inline", "inline", "thumbnail", "avatar", "full")},
		Divider: {visible},
		Progress: {visible, attr("value", AttrNumberOrNull, nil), str("label", nil),
			enum("variant", "bar", "bar", "spinner")},
		Button: {visible, disabled, str("label", ""),
			enum("variant", "secondary", "primary", "secondary", "plain", "success", "failure"),
			handler("onPress")},
		Input: {visible, disabled, bind, str("label", nil), str("placeholder", nil),
			str("error", ""),
			enum("variant", "text", "text", "multiline", "password", "number", "email"),
			handler("onChange"), handler("onSubmit")},
		Checkbox: {visible, disabled, bind, str("label", ""),
			enum("variant", "checkbox", "checkbox", "switch"), handler("onChange")},
		Select: {visible, disabled, bind, str("label", nil),
			attr("options", AttrOptions, nil),
			enum("variant", "dropdown", "dropdown", "radio", "segmented"),
			handler("onChange")},
		Slider: {visible, disabled, bind, str("label", nil),
			attr("min", AttrNumber, 0.0), attr("max", AttrNumber, 100.0),
			attr("step", AttrNumber, 1.0), handler("onChange")},
	}
}()
