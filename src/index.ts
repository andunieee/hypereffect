// Types and helpers for hypereffect (https://hypereffect.dev), a small
// hypermedia protocol for server-driven UI.
//
// - Elements, handlers, server and renderer messages, and the line framing.
//   Building an interface looks like
//   ui.text('title').parent('main').variant('h1').text('Inbox').
// - Signals: merge patch, local signals and signal paths.
// - The components, their attributes and nesting rules.
// - An App interface for per-session logic, and a Server that drives one
//   from any transport.
//
// The renderer side, for tests, is in '@hypereffect/server/client'.

export * from './components.ts';
export * from './message.ts';
export * from './server.ts';
export * from './signals.ts';
