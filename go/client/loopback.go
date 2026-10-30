package client

import (
	"time"

	he "github.com/hypereffect/hypereffect/go"
)

// Loopback connects a [Client] to a [hypereffect.Server] in the same
// process, for testing an app without a renderer.
//
//	l := client.NewLoopback(func() *Counter { return &Counter{} })
//	l.Trigger("inc", "onPress")
//	v, _ := l.Client.Attr("value", "text") // "Count: 1"
type Loopback[A he.App] struct {
	Client *Client
	Server *he.Server[A]
}

// NewLoopback starts a session.
func NewLoopback[A he.App](newApp func() A) *Loopback[A] {
	return NewLoopbackWithParams(newApp, nil)
}

// NewLoopbackWithParams starts a session whose hello carries these params.
func NewLoopbackWithParams[A he.App](newApp func() A, params map[string]string) *Loopback[A] {
	l := &Loopback[A]{Client: New(), Server: he.NewServer(newApp)}
	l.Server.Receive([]byte(l.Client.HelloWith(params)))
	l.Pump()
	return l
}

// Pump delivers the server's pending output to the client.
func (l *Loopback[A]) Pump() {
	l.Client.Receive([]byte(l.Server.Output().Take()))
}

// Trigger triggers a handler, and delivers the action (if any) and the
// response. It reports whether an action was sent.
func (l *Loopback[A]) Trigger(id, event string) bool {
	line, ok := l.Client.Trigger(id, event)
	if !ok {
		return false
	}
	l.Server.Receive([]byte(line))
	l.Pump()
	return true
}

// Write writes to a bound signal, as a control does.
func (l *Loopback[A]) Write(path string, value any) {
	l.Client.Write(path, value)
}

// Tick runs the app's timer and delivers its output.
func (l *Loopback[A]) Tick(now time.Time) {
	l.Server.Tick(now)
	l.Pump()
}
