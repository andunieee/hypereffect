//! Types and helpers for [hypereffect](https://github.com/andunieee/hypereffect),
//! a small hypermedia protocol for server-driven UI.
//!
//! - [`message`]: elements, handlers, server and renderer messages, and the
//!   line framing. Building an interface looks like
//!   `ui::text("title").parent("main").variant("h1").text("Inbox")`.
//! - [`signals`]: merge patch, local signals and signal paths.
//! - [`component`]: the components, their attributes and nesting rules.
//! - [`server`]: an [`App`](server::App) trait for per-session logic, and
//!   [`wasm_app!`] to export one from a WebAssembly module.
//! - [`client`] (feature `client`): the renderer side without drawing. It
//!   keeps the element tree and signals, evaluates CEL expressions and yields
//!   elements with resolved attribute values.

pub mod component;
pub mod message;
pub mod server;
pub mod signals;

#[cfg(feature = "client")]
pub mod client;

pub use component::Component;
pub use message::{
    cel, is_cel, ui, Action, Element, Handler, LineBuffer, ParseError, RendererMessage,
    ServerMessage,
};
pub use serde_json::{self, json, Map, Value};
pub use server::{App, Outbox, Server};
