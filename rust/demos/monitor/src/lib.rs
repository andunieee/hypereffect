//! A temperature monitor, as the device itself would serve it. A simulated
//! sensor produces a reading every half second while it is online; the
//! readings land in a log that keeps only a window on the surface. The same
//! pattern fits a 3D printer's heater, a freezer or a server room.

use hypereffect::ui::*;
use hypereffect::{cel, json, Action, App, Handler, Outbox, Value};
use std::collections::BTreeMap;

/// Simulated devices: name, label, steady temperature in °C, volatility.
const DEVICES: [(&str, &str, f64, f64); 3] = [
    ("ambient", "Room sensor (21 °C)", 21.0, 0.3),
    ("printer", "3D printer heater (60 °C)", 60.0, 2.5),
    ("cooler", "Cooler unit (4 °C)", 4.0, 0.8),
];
/// What share of the way to the steady temperature a reading moves.
const WARM: f64 = 0.15;
/// How many log rows are on the surface.
const SHOWN: usize = 8;
/// How many readings are kept, beyond the visible window.
const HISTORY: usize = 60;
/// The alarm limit a session starts with, in °C.
const ALARM: f64 = 25.0;

/// One logged reading. The severity is frozen at the time it was taken:
/// changing the alarm later does not rewrite history.
struct Reading {
    idx: u32,
    label: String,
    hot: bool,
}

pub struct Monitor {
    online: bool,
    device: usize,
    alarm: f64,
    /// The current temperature, which drifts toward the device's steady one.
    t: f64,
    noise: u32,
    /// Statistics since the log was last cleared.
    count: u32,
    min: f64,
    max: f64,
    sum: f64,
    log: Vec<Reading>,
    next: u32,
    /// The ids of the log rows the surface holds now.
    shown: Vec<u32>,
}

impl Default for Monitor {
    fn default() -> Self {
        Monitor {
            online: false,
            device: 0,
            alarm: ALARM,
            t: DEVICES[0].2,
            noise: 1,
            count: 0,
            min: 0.0,
            max: 0.0,
            sum: 0.0,
            log: Vec::new(),
            next: 0,
            shown: Vec::new(),
        }
    }
}

impl Monitor {
    /// Readings jitter by a few counts in the last digit, like a real meter.
    fn jitter(&mut self, scale: f64) -> f64 {
        self.noise = self.noise.wrapping_mul(1_103_515_245).wrapping_add(12_345);
        ((self.noise >> 16) % 1000) as f64 / 1000.0 * scale - scale / 2.0
    }

    fn label(t: f64) -> String {
        format!("{t:.1} °C")
    }

    fn meter(&self) -> Value {
        json!({
            "meter": {
                "t": Monitor::label(self.t),
                "temp": (self.t * 100.0).round() / 100.0,
                "avg": if self.count == 0 { "—".into() } else { format!("{:.1} °C", self.sum / self.count as f64) },
                "min": if self.count == 0 { "—".into() } else { Monitor::label(self.min) },
                "max": if self.count == 0 { "—".into() } else { Monitor::label(self.max) },
                "c": format!("{}", self.count),
                "n": self.count as f64,
                "hot": self.t >= self.alarm,
            }
        })
    }

    /// Sends the log rows in the window, replacing those already shown and
    /// removing the ones left over.
    fn render_log(&mut self, out: &mut Outbox) {
        let window: Vec<u32> = {
            let mut w: Vec<u32> = self.log.iter().rev().take(SHOWN).map(|r| r.idx).collect();
            w.reverse();
            w
        };
        for idx in &self.shown {
            if !window.contains(idx) {
                out.remove(format!("log-{idx}"));
            }
        }
        for idx in &window {
            if self.shown.contains(idx) {
                continue;
            }
            let Some(r) = self.log.iter().find(|r| r.idx == *idx) else {
                continue;
            };
            let id = format!("log-{idx}");
            out.element(row(id.as_str()).parent("log").justify("between"));
            out.element(text(format!("{id}-t")).parent(id.as_str()).text(&*r.label));
            out.element(
                badge(format!("{id}-b"))
                    .parent(id.as_str())
                    .variant(if r.hot { "failure" } else { "success" })
                    .text(if r.hot { "hot" } else { "ok" }),
            );
        }
        self.shown = window;
    }
}

impl App for Monitor {
    fn hello(&mut self, out: &mut Outbox, _: &BTreeMap<String, String>) {
        out.signal(json!({
            "online": self.online,
            "alarm": self.alarm,
            "device": DEVICES[self.device].0,
        }));
        out.signal(self.meter());

        out.element(card("monitor").title("Temperature monitor"));
        out.element(
            row("readout")
                .parent("monitor")
                .justify("between")
                .wrap(true),
        );
        for (key, value, name) in [
            ("t", cel("s.meter.t"), "Current"),
            ("a", cel("s.meter.avg"), "Average"),
            ("c", cel("s.meter.c"), "Readings"),
        ] {
            let col = format!("{key}-col");
            out.element(column(col.as_str()).parent("readout").gap("none"));
            out.element(
                text(format!("{key}-value"))
                    .parent(col.as_str())
                    .variant("h1")
                    .text(value),
            );
            out.element(
                text(format!("{key}-name"))
                    .parent(col.as_str())
                    .variant("caption")
                    .text(name),
            );
        }
        out.element(row("status").parent("monitor"));
        out.element(
            badge("level")
                .parent("status")
                .variant(cel("s.meter.hot ? 'failure' : 'success'"))
                .text(cel("s.meter.hot ? 'Above the alarm' : 'Within limits'")),
        );
        out.element(
            progress("closeness")
                .parent("monitor")
                .label("Alarm limit")
                .value(cel("s.meter.temp / s.alarm")),
        );
        out.element(
            notice("alarm")
                .parent("monitor")
                .variant("failure")
                .title("Above the alarm limit")
                .text(cel("'It reached ' + s.meter.t + '.'"))
                .visible(cel("s.meter.hot")),
        );

        out.element(card("sensor").title("The device (simulated)"));
        out.element(
            select("device")
                .parent("sensor")
                .label("Device")
                .bind("device")
                .options(Value::Array(
                    DEVICES
                        .iter()
                        .map(|(value, label, ..)| json!({ "value": value, "label": label }))
                        .collect(),
                ))
                .on_change(Handler::action("device")),
        );
        out.element(
            checkbox("online")
                .parent("sensor")
                .variant("switch")
                .label("Online")
                .bind("online")
                .on_change(Handler::action("online")),
        );
        out.element(
            slider("alarm")
                .parent("sensor")
                .label("Alarm limit (°C)")
                .bind("alarm")
                .min(1)
                .max(90)
                .step(1)
                .on_change(Handler::action("alarm")),
        );
        out.element(
            button("clear")
                .parent("sensor")
                .variant("secondary")
                .label("Clear the log")
                .disabled(cel("s.meter.n == 0"))
                .on_press(Handler::action("clear")),
        );

        out.element(
            text("log-title")
                .parent("monitor")
                .variant("h3")
                .text("Log"),
        );
        out.element(list("log").parent("monitor").empty("No readings yet."));
        self.render_log(out);
    }

    fn action(&mut self, out: &mut Outbox, action: &Action) {
        match action.name.as_str() {
            "online" => {
                self.online = action
                    .signal("online")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
            }
            "alarm" => {
                if let Some(a) = action.signal("alarm").and_then(Value::as_f64) {
                    self.alarm = a.clamp(1.0, 90.0);
                }
                // The level of the reading on the surface may change.
                out.signal(self.meter());
            }
            "device" => {
                let name = action.signal("device").and_then(Value::as_str);
                if let Some(n) = DEVICES.iter().position(|d| Some(d.0) == name) {
                    self.device = n;
                }
            }
            "clear" => {
                let ids = std::mem::take(&mut self.shown);
                for idx in ids {
                    out.remove(format!("log-{idx}"));
                }
                self.log.clear();
                self.count = 0;
                self.min = self.t;
                self.max = self.t;
                self.sum = 0.0;
                out.signal(self.meter());
            }
            _ => {}
        }
    }

    fn tick(&mut self, out: &mut Outbox, _now_ms: f64) {
        if !self.online {
            return;
        }
        let (.., base, volatility) = DEVICES[self.device];
        self.t += (base - self.t) * WARM + self.jitter(volatility);
        self.count += 1;
        self.min = if self.count == 1 {
            self.t
        } else {
            self.min.min(self.t)
        };
        self.max = if self.count == 1 {
            self.t
        } else {
            self.max.max(self.t)
        };
        self.sum += self.t;
        let reading = Reading {
            idx: self.next,
            label: Monitor::label(self.t),
            hot: self.t >= self.alarm,
        };
        self.next += 1;
        self.log.push(reading);
        if self.log.len() > HISTORY {
            self.log.remove(0);
        }
        self.render_log(out);
        out.signal(self.meter());
    }

    fn tick_interval(&self) -> Option<u32> {
        self.online.then_some(500)
    }
}

hypereffect::wasm_app!(Monitor);
