//! A countdown timer. The server keeps time and pushes updates on its own,
//! without waiting for actions.

use hypereffect::ui::*;
use hypereffect::{cel, json, Action, App, Handler, Map, Outbox, Value};

pub struct Timer {
    /// The length of the countdown, in seconds.
    duration: u32,
    remaining_ms: f64,
    running: bool,
    /// The time of the previous tick while running.
    last: Option<f64>,
    /// The whole seconds last sent as `remaining`.
    shown: u32,
    laps: Vec<u32>,
}

impl Default for Timer {
    fn default() -> Self {
        Timer {
            duration: 30,
            remaining_ms: 30_000.0,
            running: false,
            last: None,
            shown: 30,
            laps: Vec::new(),
        }
    }
}

impl Timer {
    fn remaining(&self) -> u32 {
        (self.remaining_ms / 1000.0).ceil() as u32
    }

    fn state(&self) -> Value {
        json!({
            "duration": self.duration,
            "remaining": self.remaining(),
            "running": self.running,
            "finished": self.remaining_ms <= 0.0,
        })
    }
}

const CLOCK: &str = "string(signals.remaining / 60) + ':' + \
    (signals.remaining % 60 < 10 ? '0' : '') + string(signals.remaining % 60)";

impl App for Timer {
    fn hello(&mut self, out: &mut Outbox, _signals: &Map<String, Value>) {
        out.signal(self.state());
        out.element(card("timer").title("Countdown"));
        out.element(text("clock").parent("timer").variant("h1").text(cel(CLOCK)));
        out.element(
            progress("bar")
                .parent("timer")
                .value(cel("double(signals.remaining) / double(signals.duration)")),
        );
        out.element(
            slider("duration")
                .parent("timer")
                .label("Length (seconds)")
                .bind("duration")
                .min(5)
                .max(120)
                .step(5)
                .disabled(cel("signals.running"))
                .on_change(Handler::action("duration")),
        );
        out.element(row("controls").parent("timer"));
        out.element(
            button("start")
                .parent("controls")
                .variant("primary")
                .label(cel("signals.running ? 'Pause' : (signals.remaining < signals.duration && !signals.finished ? 'Resume' : 'Start')"))
                .disabled(cel("signals.finished"))
                .on_press(Handler::action("toggle")),
        );
        out.element(
            button("lap")
                .parent("controls")
                .label("Lap")
                .disabled(cel("!signals.running"))
                .on_press(Handler::action("lap")),
        );
        out.element(
            button("reset")
                .parent("controls")
                .variant("plain")
                .label("Reset")
                .disabled(cel(
                    "signals.remaining == signals.duration && !signals.running",
                ))
                .on_press(Handler::action("reset")),
        );
        out.element(
            badge("status")
                .parent("controls")
                .variant(cel("signals.running ? 'info' : 'neutral'"))
                .text(cel(
                    "signals.running ? 'running' : (signals.finished ? 'done' : 'paused')",
                )),
        );
        out.element(
            notice("done")
                .parent("timer")
                .variant("success")
                .title("Time’s up")
                .text(cel(
                    "'The ' + string(signals.duration) + ' second countdown finished.'",
                ))
                .visible(cel("signals.finished")),
        );
        out.element(
            list("laps")
                .parent("timer")
                .empty("Laps appear here.")
                .visible(cel(
                    "signals.running || signals.remaining < signals.duration",
                )),
        );
    }

    fn action(&mut self, out: &mut Outbox, action: &Action) {
        match action.name.as_str() {
            "toggle" if self.remaining_ms > 0.0 => {
                self.running = !self.running;
                self.last = None;
            }
            "reset" => {
                self.running = false;
                self.remaining_ms = self.duration as f64 * 1000.0;
                for i in 0..self.laps.len() {
                    out.remove(format!("lap-{i}"));
                }
                self.laps.clear();
            }
            "duration" if !self.running => {
                if let Some(d) = action.signal("duration").and_then(Value::as_f64) {
                    self.duration = (d.round() as u32).clamp(5, 120) / 5 * 5;
                    self.remaining_ms = self.duration as f64 * 1000.0;
                }
            }
            "lap" if self.running => {
                let i = self.laps.len();
                let at = self.duration - self.remaining();
                self.laps.push(at);
                let first = (i > 0).then(|| format!("lap-{}", i - 1));
                let mut e = text(format!("lap-{i}")).parent("laps").text(format!(
                    "Lap {}: {} s",
                    i + 1,
                    at
                ));
                if let Some(f) = first {
                    e = e.before(f);
                }
                out.element(e);
            }
            _ => {}
        }
        self.shown = self.remaining();
        out.signal(self.state());
    }

    fn tick(&mut self, out: &mut Outbox, now_ms: f64) {
        if !self.running {
            return;
        }
        if let Some(last) = self.last {
            self.remaining_ms = (self.remaining_ms - (now_ms - last)).max(0.0);
        }
        self.last = Some(now_ms);
        if self.remaining_ms <= 0.0 {
            self.running = false;
        }
        if self.remaining() != self.shown || !self.running {
            self.shown = self.remaining();
            out.signal(self.state());
        }
    }

    fn tick_interval(&self) -> Option<u32> {
        self.running.then_some(100)
    }
}

hypereffect::wasm_app!(Timer);
