//! The eighteen components, their attributes and the nesting rules.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Component {
    Column,
    Row,
    Card,
    List,
    Tabs,
    Tab,
    Dialog,
    Text,
    Notice,
    Badge,
    Image,
    Divider,
    Progress,
    Button,
    Input,
    Checkbox,
    Select,
    Slider,
}

impl Component {
    pub const ALL: [Component; 18] = [
        Component::Column,
        Component::Row,
        Component::Card,
        Component::List,
        Component::Tabs,
        Component::Tab,
        Component::Dialog,
        Component::Text,
        Component::Notice,
        Component::Badge,
        Component::Image,
        Component::Divider,
        Component::Progress,
        Component::Button,
        Component::Input,
        Component::Checkbox,
        Component::Select,
        Component::Slider,
    ];

    pub fn name(self) -> &'static str {
        match self {
            Component::Column => "column",
            Component::Row => "row",
            Component::Card => "card",
            Component::List => "list",
            Component::Tabs => "tabs",
            Component::Tab => "tab",
            Component::Dialog => "dialog",
            Component::Text => "text",
            Component::Notice => "notice",
            Component::Badge => "badge",
            Component::Image => "image",
            Component::Divider => "divider",
            Component::Progress => "progress",
            Component::Button => "button",
            Component::Input => "input",
            Component::Checkbox => "checkbox",
            Component::Select => "select",
            Component::Slider => "slider",
        }
    }

    pub fn from_name(name: &str) -> Option<Component> {
        Component::ALL.into_iter().find(|c| c.name() == name)
    }

    fn is_container(self) -> bool {
        matches!(
            self,
            Component::Column
                | Component::Row
                | Component::Card
                | Component::List
                | Component::Tab
                | Component::Dialog
        )
    }

    /// Whether this component has a `disabled` attribute.
    pub fn is_control(self) -> bool {
        matches!(
            self,
            Component::Button
                | Component::Input
                | Component::Checkbox
                | Component::Select
                | Component::Slider
        )
    }

    /// The attributes of this component other than `id`, `type`, `parent`
    /// and `before`, including `visible` and, for controls, `disabled`.
    pub fn attrs(self) -> &'static [Attr] {
        use AttrDefault::*;
        use AttrType::*;
        const GAP: AttrType = Enum(&["none", "small", "medium", "large"]);
        const ALIGN: AttrType = Enum(&["start", "center", "end", "stretch"]);
        const JUSTIFY: AttrType = Enum(&["start", "center", "end", "between"]);
        const fn a(name: &'static str, ty: AttrType, default: AttrDefault) -> Attr {
            Attr { name, ty, default }
        }
        const VISIBLE: Attr = a("visible", Bool, BoolValue(true));
        const DISABLED: Attr = a("disabled", Bool, BoolValue(false));
        match self {
            Component::Column => {
                const {
                    &[
                        VISIBLE,
                        a("gap", GAP, Str("medium")),
                        a("align", ALIGN, Str("stretch")),
                    ]
                }
            }
            Component::Row => {
                const {
                    &[
                        VISIBLE,
                        a("gap", GAP, Str("small")),
                        a("align", ALIGN, Str("center")),
                        a("justify", JUSTIFY, Str("start")),
                        a("wrap", Bool, BoolValue(false)),
                    ]
                }
            }
            Component::Card => {
                const {
                    &[
                        VISIBLE,
                        a("title", String, Null),
                        a("gap", GAP, Str("medium")),
                    ]
                }
            }
            Component::List => const { &[VISIBLE, a("empty", String, Null)] },
            Component::Tabs => {
                const { &[VISIBLE, a("bind", Path, Null), a("onChange", Handler, Null)] }
            }
            Component::Tab => {
                const {
                    &[
                        VISIBLE,
                        a("label", String, Id),
                        a("gap", GAP, Str("medium")),
                    ]
                }
            }
            Component::Dialog => {
                const {
                    &[
                        VISIBLE,
                        a("open", Bool, BoolValue(true)),
                        a("title", String, Null),
                        a("onDismiss", Handler, Null),
                    ]
                }
            }
            Component::Text => {
                const {
                    &[
                        VISIBLE,
                        a("text", String, Str("")),
                        a(
                            "variant",
                            Enum(&["h1", "h2", "h3", "body", "caption", "code"]),
                            Str("body"),
                        ),
                    ]
                }
            }
            Component::Notice => {
                const {
                    &[
                        VISIBLE,
                        a("title", String, Null),
                        a("text", String, Str("")),
                        a(
                            "variant",
                            Enum(&["info", "success", "warning", "failure"]),
                            Str("info"),
                        ),
                    ]
                }
            }
            Component::Badge => {
                const {
                    &[
                        VISIBLE,
                        a("text", String, Str("")),
                        a(
                            "variant",
                            Enum(&["neutral", "info", "success", "warning", "failure"]),
                            Str("neutral"),
                        ),
                    ]
                }
            }
            Component::Image => {
                const {
                    &[
                        VISIBLE,
                        a("src", String, Str("")),
                        a("alt", String, Str("")),
                        a(
                            "variant",
                            Enum(&["inline", "thumbnail", "avatar", "full"]),
                            Str("inline"),
                        ),
                    ]
                }
            }
            Component::Divider => const { &[VISIBLE] },
            Component::Progress => {
                const {
                    &[
                        VISIBLE,
                        a("value", NumberOrNull, Null),
                        a("label", String, Null),
                        a("variant", Enum(&["bar", "spinner"]), Str("bar")),
                    ]
                }
            }
            Component::Button => {
                const {
                    &[
                        VISIBLE,
                        DISABLED,
                        a("label", String, Str("")),
                        a(
                            "variant",
                            Enum(&["primary", "secondary", "plain", "success", "failure"]),
                            Str("secondary"),
                        ),
                        a("onPress", Handler, Null),
                    ]
                }
            }
            Component::Input => {
                const {
                    &[
                        VISIBLE,
                        DISABLED,
                        a("bind", Path, Null),
                        a("label", String, Null),
                        a("placeholder", String, Null),
                        a("error", String, Str("")),
                        a(
                            "variant",
                            Enum(&["text", "multiline", "password", "number", "email"]),
                            Str("text"),
                        ),
                        a("onChange", Handler, Null),
                        a("onSubmit", Handler, Null),
                    ]
                }
            }
            Component::Checkbox => {
                const {
                    &[
                        VISIBLE,
                        DISABLED,
                        a("bind", Path, Null),
                        a("label", String, Str("")),
                        a("variant", Enum(&["checkbox", "switch"]), Str("checkbox")),
                        a("onChange", Handler, Null),
                    ]
                }
            }
            Component::Select => {
                const {
                    &[
                        VISIBLE,
                        DISABLED,
                        a("bind", Path, Null),
                        a("label", String, Null),
                        a("options", Options, EmptyList),
                        a(
                            "variant",
                            Enum(&["dropdown", "radio", "segmented"]),
                            Str("dropdown"),
                        ),
                        a("onChange", Handler, Null),
                    ]
                }
            }
            Component::Slider => {
                const {
                    &[
                        VISIBLE,
                        DISABLED,
                        a("bind", Path, Null),
                        a("label", String, Null),
                        a("min", Number, Num(0.0)),
                        a("max", Number, Num(100.0)),
                        a("step", Number, Num(1.0)),
                        a("onChange", Handler, Null),
                    ]
                }
            }
        }
    }

    pub fn attr(self, name: &str) -> Option<&'static Attr> {
        self.attrs().iter().find(|a| a.name == name)
    }
}

impl std::fmt::Display for Component {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.name())
    }
}

/// Whether an element of type `child` may be placed in `parent` (`None` for
/// the root).
pub fn accepts(parent: Option<Component>, child: Component) -> bool {
    match parent {
        None => child != Component::Tab,
        Some(Component::Tabs) => child == Component::Tab,
        Some(p) => child != Component::Tab && child != Component::Dialog && p.is_container(),
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Attr {
    pub name: &'static str,
    pub ty: AttrType,
    pub default: AttrDefault,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum AttrType {
    String,
    Bool,
    Number,
    NumberOrNull,
    /// A string from a fixed set. Unknown values are treated as the default.
    Enum(&'static [&'static str]),
    /// A list of `{"value": string, "label": string}`.
    Options,
    /// A signal path. Structural.
    Path,
    /// A handler object. Structural.
    Handler,
}

impl AttrType {
    pub fn is_structural(self) -> bool {
        matches!(self, AttrType::Path | AttrType::Handler)
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum AttrDefault {
    Null,
    Str(&'static str),
    BoolValue(bool),
    Num(f64),
    EmptyList,
    /// The element's id (the label of a tab).
    Id,
}

impl AttrDefault {
    pub fn value(self, id: &str) -> Value {
        match self {
            AttrDefault::Null => Value::Null,
            AttrDefault::Str(s) => s.into(),
            AttrDefault::BoolValue(b) => b.into(),
            AttrDefault::Num(n) => n.into(),
            AttrDefault::EmptyList => Value::Array(vec![]),
            AttrDefault::Id => id.into(),
        }
    }
}
