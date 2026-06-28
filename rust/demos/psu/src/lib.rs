//! The control panel of a bench power supply, as the device itself would
//! serve it over a serial line. The supply and the load on its terminals are
//! simulated; the readings are pushed while the output is on.

use hypereffect::ui::*;
use hypereffect::{cel, json, Action, App, Handler, Map, Outbox, Value};

const MAX_V: f64 = 30.0;
const MAX_I: f64 = 5.0;
const PRESETS: [(f64, f64); 3] = [(3.3, 0.5), (5.0, 1.0), (12.0, 2.0)];
/// The loads that can be put on the terminals, with their resistance in ohms.
const LOADS: [(&str, &str, f64); 4] = [
    ("open", "Nothing connected", f64::INFINITY),
    ("led", "LED strip (24 Ω)", 24.0),
    ("motor", "DC motor (6 Ω)", 6.0),
    ("short", "Short circuit", 0.05),
];

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Mode {
    Off,
    /// Constant voltage: the load draws less than the current limit.
    Cv,
    /// Constant current: the supply lowers the voltage to hold the limit.
    Cc,
}

impl Mode {
    fn name(self) -> &'static str {
        match self {
            Mode::Off => "off",
            Mode::Cv => "cv",
            Mode::Cc => "cc",
        }
    }
}

pub struct Psu {
    set_v: f64,
    set_i: f64,
    output: bool,
    /// Turn the output off when the current limit is reached.
    ocp: bool,
    tripped: bool,
    load: usize,
    /// The voltage on the terminals, which follows the target with a lag.
    v: f64,
    i: f64,
    mode: Mode,
    last: Option<f64>,
    noise: u32,
}

impl Default for Psu {
    fn default() -> Self {
        Psu {
            set_v: 5.0,
            set_i: 1.0,
            output: false,
            ocp: false,
            tripped: false,
            load: 1,
            v: 0.0,
            i: 0.0,
            mode: Mode::Off,
            last: None,
            noise: 1,
        }
    }
}

impl Psu {
    pub fn mode(&self) -> Mode {
        self.mode
    }

    /// Readings jitter by a few counts in the last digit, like a real meter.
    fn jitter(&mut self, scale: f64) -> f64 {
        self.noise = self.noise.wrapping_mul(1_103_515_245).wrapping_add(12_345);
        ((self.noise >> 16) % 1000) as f64 / 1000.0 * scale - scale / 2.0
    }

    fn resistance(&self, now_ms: f64) -> f64 {
        let (name, _, r) = LOADS[self.load];
        // A motor's current ripples as it turns.
        if name == "motor" {
            r * (1.0 + 0.08 * (now_ms / 90.0).sin())
        } else {
            r
        }
    }

    /// Moves the output toward what the supply regulates to, `dt` ms later.
    fn step(&mut self, now_ms: f64, dt: f64) {
        let r = self.resistance(now_ms);
        let (target, mode) = if !self.output {
            (0.0, Mode::Off)
        } else if self.set_v / r > self.set_i {
            (self.set_i * r, Mode::Cc)
        } else {
            (self.set_v, Mode::Cv)
        };
        self.mode = mode;
        self.v += (target - self.v) * (dt / 120.0).min(1.0);
        if self.v.abs() < 0.001 {
            self.v = 0.0;
        }
        self.i = if r.is_finite() { self.v / r } else { 0.0 };
        if mode == Mode::Cc && self.ocp {
            self.output = false;
            self.tripped = true;
            self.mode = Mode::Off;
        }
    }

    fn settings(&self) -> Value {
        json!({
            "set": { "v": self.set_v, "i": self.set_i },
            "out": self.output,
            "ocp": self.ocp,
            "tripped": self.tripped,
            "limit": format!("{:.2}", self.set_i),
            "load": LOADS[self.load].0,
        })
    }

    fn meter(&mut self) -> Value {
        let on = self.v > 0.0;
        let v = if on { self.v + self.jitter(0.006) } else { 0.0 };
        let i = if on && self.i > 0.0 { self.i + self.jitter(0.0006) } else { 0.0 };
        json!({ "meter": {
            "v": format!("{:.2}", v.max(0.0)),
            "i": format!("{:.3}", i.max(0.0)),
            "p": format!("{:.2}", (v * i).max(0.0)),
            "mode": self.mode.name(),
            "load": if self.set_i > 0.0 { (self.i / self.set_i).min(1.0) } else { 0.0 },
        }})
    }
}

impl App for Psu {
    fn hello(&mut self, out: &mut Outbox, _signals: &Map<String, Value>) {
        out.signal(self.settings());
        let meter = self.meter();
        out.signal(meter);

        out.element(card("psu").title("Bench supply · channel 1"));
        out.element(row("readout").parent("psu").justify("between").wrap(true));
        for (id, unit, name) in [("v", "V", "Voltage"), ("i", "A", "Current"), ("p", "W", "Power")] {
            let col = format!("{id}-col");
            out.element(column(col.as_str()).parent("readout").gap("none"));
            out.element(
                text(format!("{id}-value"))
                    .parent(col.as_str())
                    .variant("h1")
                    .text(cel(format!("s.meter.{id} + ' {unit}'"))),
            );
            out.element(text(format!("{id}-name")).parent(col.as_str()).variant("caption").text(name));
        }
        out.element(row("status").parent("psu"));
        out.element(
            badge("mode")
                .parent("status")
                .variant(cel(
                    "s.meter.mode == 'cc' ? 'warning' : s.meter.mode == 'cv' ? 'success' : 'neutral'",
                ))
                .text(cel(
                    "s.meter.mode == 'cc' ? 'CC · current limited' : \
                     s.meter.mode == 'cv' ? 'CV · constant voltage' : 'Output off'",
                )),
        );
        out.element(
            progress("headroom")
                .parent("psu")
                .label("Current, of the limit")
                .value(cel("s.meter.load")),
        );
        out.element(
            notice("tripped")
                .parent("psu")
                .variant("failure")
                .title("Over-current protection")
                .text(cel(
                    "'The output was turned off when the load reached ' + s.limit + ' A.'",
                ))
                .visible(cel("s.tripped")),
        );
        out.element(divider("rule").parent("psu"));
        out.element(
            slider("set-v")
                .parent("psu")
                .label("Voltage (V)")
                .bind("set.v")
                .min(0)
                .max(MAX_V)
                .step(0.1)
                .on_change(Handler::action("set")),
        );
        out.element(
            slider("set-i")
                .parent("psu")
                .label("Current limit (A)")
                .bind("set.i")
                .min(0)
                .max(MAX_I)
                .step(0.05)
                .on_change(Handler::action("set")),
        );
        out.element(row("presets").parent("psu").wrap(true));
        for (n, (v, i)) in PRESETS.into_iter().enumerate() {
            out.element(
                button(format!("preset-{n}"))
                    .parent("presets")
                    .variant("plain")
                    .label(format!("{v} V · {i} A"))
                    .on_press(
                        Handler::action("set").with_patch(json!({ "set": { "v": v, "i": i } })),
                    ),
            );
        }
        out.element(
            checkbox("out")
                .parent("psu")
                .variant("switch")
                .label("Output")
                .bind("out")
                .on_change(Handler::action("output")),
        );
        out.element(
            checkbox("ocp")
                .parent("psu")
                .label("Turn the output off at the current limit")
                .bind("ocp")
                .on_change(Handler::action("ocp")),
        );

        out.element(card("bench").title("On the bench (simulated)"));
        out.element(
            select("load")
                .parent("bench")
                .label("Load on the terminals")
                .bind("load")
                .options(Value::Array(
                    LOADS
                        .iter()
                        .map(|(value, label, _)| json!({ "value": value, "label": label }))
                        .collect(),
                ))
                .on_change(Handler::action("load")),
        );
    }

    fn action(&mut self, out: &mut Outbox, action: &Action) {
        let num = |path| action.signal(path).and_then(Value::as_f64);
        match action.name.as_str() {
            "set" => {
                if let Some(v) = num("set.v") {
                    self.set_v = ((v * 10.0).round() / 10.0).clamp(0.0, MAX_V);
                }
                if let Some(i) = num("set.i") {
                    self.set_i = ((i * 100.0).round() / 100.0).clamp(0.0, MAX_I);
                }
            }
            "output" => {
                self.output = action.signal("out").and_then(Value::as_bool).unwrap_or(false);
                if self.output {
                    self.tripped = false;
                }
            }
            "ocp" => self.ocp = action.signal("ocp").and_then(Value::as_bool).unwrap_or(false),
            "load" => {
                let name = action.signal("load").and_then(Value::as_str);
                if let Some(n) = LOADS.iter().position(|l| Some(l.0) == name) {
                    self.load = n;
                }
            }
            _ => {}
        }
        out.signal(self.settings());
    }

    fn tick(&mut self, out: &mut Outbox, now_ms: f64) {
        let dt = self.last.map_or(0.0, |last| now_ms - last);
        self.last = Some(now_ms);
        let was = self.output;
        self.step(now_ms, dt);
        if self.output != was {
            out.signal(self.settings());
        }
        let meter = self.meter();
        out.signal(meter);
        if self.v == 0.0 && !self.output {
            self.last = None;
        }
    }

    fn tick_interval(&self) -> Option<u32> {
        (self.output || self.v > 0.0).then_some(250)
    }
}

hypereffect::wasm_app!(Psu);
