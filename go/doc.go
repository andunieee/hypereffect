// Package hypereffect has types and helpers for hypereffect
// (https://hypereffect.dev), a small hypermedia protocol for server-driven
// UI.
//
//   - Elements, handlers, server and renderer messages, and the line
//     framing. Building an interface looks like
//     ui.Text("title").Parent("main").Variant("h1").Text("Inbox"), with the
//     constructors in package [github.com/hypereffect/hypereffect-go/ui].
//   - The components, their attributes and nesting rules.
//   - An [App] interface for per-session logic and a [Server] that drives
//     one over a byte stream, from any transport.
//   - Package [github.com/hypereffect/hypereffect-go/signals]: merge patch,
//     local signals and signal paths.
//   - Package [github.com/hypereffect/hypereffect-go/client]: the renderer
//     side without drawing, and a Loopback that connects it to a Server for
//     tests.
package hypereffect
