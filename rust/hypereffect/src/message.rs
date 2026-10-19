//! Messages, elements and handlers, and the line framing.

use crate::Component;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// An expression attribute value: `{"cel": "..."}`.
pub fn cel(expr: impl Into<String>) -> Value {
    let mut m = Map::new();
    m.insert("cel".into(), Value::String(expr.into()));
    Value::Object(m)
}

/// Whether a value is an expression (an object whose only member is `cel`,
/// a string).
pub fn is_cel(v: &Value) -> Option<&str> {
    match v.as_object() {
        Some(m) if m.len() == 1 => m.get("cel")?.as_str(),
        _ => None,
    }
}

/// An element: one instance of a component.
///
/// ```
/// use hypereffect::{cel, ui::button, Handler};
///
/// let e = button("inc")
///     .parent("buttons")
///     .label("+")
///     .variant("primary")
///     .disabled(cel("s.count >= 10"))
///     .on_press(Handler::action("add").payload(1));
/// assert_eq!(
///     e.to_line(),
///     r#"element {"id":"inc","type":"button","parent":"buttons","label":"+","variant":"primary","disabled":{"cel":"s.count >= 10"},"onPress":{"action":"add","payload":1}}"#.to_owned() + "\n"
/// );
/// ```
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Element {
    pub id: String,
    #[serde(rename = "type")]
    pub component: Component,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub before: Option<String>,
    #[serde(flatten)]
    pub attrs: Map<String, Value>,
}

macro_rules! setters {
    ($($fn:ident => $name:literal),* $(,)?) => {
        $(
            #[doc = concat!("Sets the `", $name, "` attribute (a literal, or an expression from [`cel`]).")]
            pub fn $fn(self, v: impl Into<Value>) -> Self {
                self.set($name, v)
            }
        )*
    };
}

macro_rules! handlers {
    ($($fn:ident => $name:literal),* $(,)?) => {
        $(
            #[doc = concat!("Sets the `", $name, "` handler.")]
            pub fn $fn(self, h: Handler) -> Self {
                self.set($name, h)
            }
        )*
    };
}

impl Element {
    pub fn new(id: impl Into<String>, component: Component) -> Self {
        Element {
            id: id.into(),
            component,
            parent: None,
            before: None,
            attrs: Map::new(),
        }
    }

    pub fn parent(mut self, parent: impl Into<String>) -> Self {
        self.parent = Some(parent.into());
        self
    }

    pub fn before(mut self, before: impl Into<String>) -> Self {
        self.before = Some(before.into());
        self
    }

    /// Sets any attribute.
    pub fn set(mut self, name: &str, v: impl Into<Value>) -> Self {
        self.attrs.insert(name.to_string(), v.into());
        self
    }

    setters! {
        visible => "visible", disabled => "disabled", gap => "gap", align => "align",
        justify => "justify", wrap => "wrap", title => "title", empty => "empty",
        label => "label", open => "open", value => "value", variant => "variant",
        src => "src", alt => "alt", placeholder => "placeholder", error => "error",
        options => "options", min => "min", max => "max", step => "step", text => "text",
    }

    /// Sets `bind`, the signal path a control reads and writes.
    pub fn bind(self, path: impl Into<String>) -> Self {
        self.set("bind", path.into())
    }

    handlers! {
        on_press => "onPress", on_change => "onChange", on_submit => "onSubmit", on_dismiss => "onDismiss",
    }

    pub fn to_message(self) -> ServerMessage {
        ServerMessage::Element(self)
    }

    pub fn to_line(&self) -> String {
        encode_line("element", self)
    }
}

impl From<Element> for ServerMessage {
    fn from(e: Element) -> Self {
        ServerMessage::Element(e)
    }
}

/// Constructors for each component: `ui::text("title")` is
/// `Element::new("title", Component::Text)`.
pub mod ui {
    use super::Element;
    use crate::Component;

    macro_rules! constructors {
        ($($fn:ident => $c:ident),* $(,)?) => {
            $(
                #[doc = concat!("A new `", stringify!($fn), "` element.")]
                pub fn $fn(id: impl Into<String>) -> Element {
                    Element::new(id, Component::$c)
                }
            )*
        };
    }

    constructors! {
        column => Column, row => Row, card => Card, list => List, tabs => Tabs, tab => Tab,
        dialog => Dialog, text => Text, notice => Notice, badge => Badge, image => Image,
        divider => Divider, progress => Progress, button => Button, input => Input,
        checkbox => Checkbox, select => Select, slider => Slider,
    }
}

/// A handler: a local patch, an action sent to the server, or both.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Handler {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub patch: Option<Map<String, Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payload: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub indicator: Option<String>,
}

impl Handler {
    /// A handler that sends an action.
    pub fn action(name: impl Into<String>) -> Self {
        Handler {
            action: Some(name.into()),
            ..Default::default()
        }
    }

    /// A handler that applies a local merge patch. Leaf values may be
    /// expressions. Panics if `patch` is not an object.
    pub fn patch(patch: Value) -> Self {
        Handler::default().with_patch(patch)
    }

    /// Adds a local patch, applied before the action is sent.
    pub fn with_patch(mut self, patch: Value) -> Self {
        let Value::Object(m) = patch else {
            panic!("a handler's patch must be an object")
        };
        self.patch = Some(m);
        self
    }

    pub fn payload(mut self, payload: impl Into<Value>) -> Self {
        self.payload = Some(payload.into());
        self
    }

    /// A local signal path set to true when the action is sent.
    pub fn indicator(mut self, path: impl Into<String>) -> Self {
        self.indicator = Some(path.into());
        self
    }
}

impl From<Handler> for Value {
    fn from(h: Handler) -> Value {
        serde_json::to_value(h).expect("handler serializes")
    }
}

/// A message from the server to the renderer.
#[derive(Debug, Clone, PartialEq)]
pub enum ServerMessage {
    Element(Element),
    Remove {
        id: String,
    },
    /// A merge patch for the signals.
    Signal(Map<String, Value>),
}

impl ServerMessage {
    pub fn remove(id: impl Into<String>) -> Self {
        ServerMessage::Remove { id: id.into() }
    }

    /// A signal message. Panics if `patch` is not an object.
    pub fn signal(patch: Value) -> Self {
        let Value::Object(m) = patch else {
            panic!("a signal message must be an object")
        };
        ServerMessage::Signal(m)
    }

    pub fn tag(&self) -> &'static str {
        match self {
            ServerMessage::Element(_) => "element",
            ServerMessage::Remove { .. } => "remove",
            ServerMessage::Signal(_) => "signal",
        }
    }

    pub fn body(&self) -> Value {
        match self {
            ServerMessage::Element(e) => serde_json::to_value(e).expect("element serializes"),
            ServerMessage::Remove { id } => serde_json::json!({ "id": id }),
            ServerMessage::Signal(m) => Value::Object(m.clone()),
        }
    }

    /// The message as a line, including the final line feed.
    pub fn to_line(&self) -> String {
        match self {
            ServerMessage::Element(e) => e.to_line(),
            ServerMessage::Signal(m) => encode_line("signal", m),
            m => encode_line(m.tag(), &m.body()),
        }
    }

    pub fn parse(line: &str) -> Result<Self, ParseError> {
        let (tag, body) = parse_line(line)?;
        Self::from_parts(tag, body)
    }

    pub fn from_parts(tag: &str, body: Map<String, Value>) -> Result<Self, ParseError> {
        match tag {
            "element" => serde_json::from_value(Value::Object(body))
                .map(ServerMessage::Element)
                .map_err(|e| ParseError::Invalid(e.to_string())),
            "remove" => match body.get("id") {
                Some(Value::String(id)) => Ok(ServerMessage::Remove { id: id.clone() }),
                _ => Err(ParseError::Invalid("remove needs a string id".into())),
            },
            "signal" => Ok(ServerMessage::Signal(body)),
            t => Err(ParseError::UnknownTag(t.to_string())),
        }
    }
}

/// A message from the renderer to the server.
#[derive(Debug, Clone, PartialEq)]
pub enum RendererMessage {
    Hello { signals: Map<String, Value> },
    Action(Action),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Action {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payload: Option<Value>,
    #[serde(default)]
    pub signals: Map<String, Value>,
}

impl Action {
    /// The payload as a type, if it has one and it has that shape.
    pub fn payload_as<T: serde::de::DeserializeOwned>(&self) -> Option<T> {
        serde_json::from_value(self.payload.clone()?).ok()
    }

    /// A signal by path, such as `form.email`.
    pub fn signal(&self, path: &str) -> Option<&Value> {
        let segs = crate::signals::parse_path(path)?;
        let (first, rest) = segs.split_first()?;
        crate::signals::get_path(self.signals.get(*first)?, rest)
    }
}

impl RendererMessage {
    pub fn to_line(&self) -> String {
        match self {
            RendererMessage::Hello { signals } if signals.is_empty() => {
                encode_line("hello", &serde_json::json!({}))
            }
            RendererMessage::Hello { signals } => {
                encode_line("hello", &serde_json::json!({ "signals": signals }))
            }
            RendererMessage::Action(a) => encode_line("action", a),
        }
    }

    pub fn parse(line: &str) -> Result<Self, ParseError> {
        let (tag, body) = parse_line(line)?;
        match tag {
            "hello" => Ok(RendererMessage::Hello {
                signals: match body.get("signals") {
                    Some(Value::Object(m)) => m.clone(),
                    _ => Map::new(),
                },
            }),
            "action" => serde_json::from_value(Value::Object(body))
                .map(RendererMessage::Action)
                .map_err(|e| ParseError::Invalid(e.to_string())),
            t => Err(ParseError::UnknownTag(t.to_string())),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum ParseError {
    /// The line does not match `tag SP json`.
    Grammar,
    Json(String),
    NotAnObject,
    UnknownTag(String),
    /// The JSON does not have the members the message needs.
    Invalid(String),
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ParseError::Grammar => write!(f, "line does not match the grammar"),
            ParseError::Json(e) => write!(f, "invalid JSON: {e}"),
            ParseError::NotAnObject => write!(f, "message body is not a JSON object"),
            ParseError::UnknownTag(t) => write!(f, "unknown tag '{t}'"),
            ParseError::Invalid(e) => write!(f, "invalid message: {e}"),
        }
    }
}

impl std::error::Error for ParseError {}

/// Encodes a message as a line, including the final line feed.
pub fn encode_line<T: Serialize + ?Sized>(tag: &str, body: &T) -> String {
    let mut s = String::with_capacity(64);
    s.push_str(tag);
    s.push(' ');
    s.push_str(&serde_json::to_string(body).expect("message serializes"));
    s.push('\n');
    s
}

/// Splits a line (without its line feed) into its tag and JSON object.
pub fn parse_line(line: &str) -> Result<(&str, Map<String, Value>), ParseError> {
    let line = line.strip_suffix('\r').unwrap_or(line);
    let (tag, json) = line.split_once(' ').ok_or(ParseError::Grammar)?;
    if tag.is_empty() || !tag.bytes().all(|b| b.is_ascii_lowercase()) {
        return Err(ParseError::Grammar);
    }
    match serde_json::from_str(json) {
        Ok(Value::Object(m)) => Ok((tag, m)),
        Ok(_) => Err(ParseError::NotAnObject),
        Err(e) => Err(ParseError::Json(e.to_string())),
    }
}

/// Splits a byte stream into lines. Empty lines are dropped and a carriage
/// return before the line feed is ignored.
#[derive(Debug, Default)]
pub struct LineBuffer {
    buf: Vec<u8>,
}

impl LineBuffer {
    pub fn new() -> Self {
        Self::default()
    }

    /// Adds bytes and returns the complete lines they finish. Lines that are
    /// not valid UTF-8 are dropped.
    pub fn push(&mut self, bytes: &[u8]) -> Vec<String> {
        self.buf.extend_from_slice(bytes);
        let mut lines = Vec::new();
        let mut start = 0;
        while let Some(i) = self.buf[start..].iter().position(|&b| b == b'\n') {
            let mut line = &self.buf[start..start + i];
            if line.last() == Some(&b'\r') {
                line = &line[..line.len() - 1];
            }
            if !line.is_empty() {
                if let Ok(s) = std::str::from_utf8(line) {
                    lines.push(s.to_string());
                }
            }
            start += i + 1;
        }
        self.buf.drain(..start);
        lines
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn element_round_trip() {
        let e = crate::ui::text("title")
            .parent("main")
            .variant("h1")
            .text("Inbox");
        let line = e.to_line();
        assert_eq!(line, "element {\"id\":\"title\",\"type\":\"text\",\"parent\":\"main\",\"variant\":\"h1\",\"text\":\"Inbox\"}\n");
        assert_eq!(
            ServerMessage::parse(line.trim_end()).unwrap(),
            ServerMessage::Element(e)
        );
    }

    #[test]
    fn handlers() {
        let h = Handler::action("login")
            .indicator("_busy")
            .with_patch(json!({"_open": false}));
        assert_eq!(
            Value::from(h),
            json!({"patch":{"_open":false},"action":"login","indicator":"_busy"})
        );
    }

    #[test]
    fn renderer_messages() {
        let m = RendererMessage::parse(
            r#"action {"name":"archive","payload":{"contact":7},"signals":{"filter":"all"}}"#,
        )
        .unwrap();
        let RendererMessage::Action(a) = &m else {
            panic!()
        };
        assert_eq!(a.signal("filter"), Some(&json!("all")));
        assert_eq!(m.to_line(), "action {\"name\":\"archive\",\"payload\":{\"contact\":7},\"signals\":{\"filter\":\"all\"}}\n");
        assert_eq!(
            RendererMessage::parse("hello {}").unwrap(),
            RendererMessage::Hello {
                signals: Map::new()
            }
        );
    }

    #[test]
    fn line_buffer() {
        let mut b = LineBuffer::new();
        assert_eq!(b.push(b"hello {}\r\n\nsig"), vec!["hello {}"]);
        assert_eq!(b.push(b"nal {}\n"), vec!["signal {}"]);
        assert!(parse_line("Signal {}").is_err());
        assert_eq!(parse_line("signal []"), Err(ParseError::NotAnObject));
    }
}
