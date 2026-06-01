//! The counter from the guide, with a choice of step size.

use hypereffect::ui::*;
use hypereffect::{cel, json, Action, App, Handler, Map, Outbox, Value};

const STEPS: [i64; 3] = [1, 5, 10];
const LIMIT: i64 = 100;

#[derive(Default)]
pub struct Counter {
    count: i64,
}

impl App for Counter {
    fn hello(&mut self, out: &mut Outbox, _signals: &Map<String, Value>) {
        out.signal(json!({ "count": self.count, "step": "1" }));
        out.element(column("main").gap("medium").align("start"));
        out.element(text("title").parent("main").variant("h1").text("Counter"));
        out.element(
            text("value")
                .parent("main")
                .variant("h2")
                .text(cel("'Count: ' + string(s.count)")),
        );
        out.element(row("buttons").parent("main"));
        out.element(
            button("dec")
                .parent("buttons")
                .label(cel("'− ' + s.step"))
                .disabled(cel(format!("s.count - int(s.step) < -{LIMIT}")))
                .on_press(Handler::action("add").payload(-1)),
        );
        out.element(
            button("inc")
                .parent("buttons")
                .variant("primary")
                .label(cel("'+ ' + s.step"))
                .disabled(cel(format!("s.count + int(s.step) > {LIMIT}")))
                .on_press(Handler::action("add").payload(1)),
        );
        out.element(
            button("reset")
                .parent("buttons")
                .variant("plain")
                .label("Reset")
                .disabled(cel("s.count == 0"))
                .on_press(Handler::action("reset")),
        );
        out.element(
            badge("zero")
                .parent("main")
                .text("zero")
                .visible(cel("s.count == 0")),
        );
        out.element(
            select("step")
                .parent("main")
                .label("Step")
                .variant("segmented")
                .bind("step")
                .options(json!(STEPS.map(
                    |s| json!({ "value": s.to_string(), "label": s.to_string() })
                ))),
        );
        out.element(
            notice("limit")
                .parent("main")
                .variant("warning")
                .text(format!("The count stays between −{LIMIT} and {LIMIT}."))
                .visible(cel(format!(
                    "s.count == {LIMIT} || s.count == -{LIMIT}"
                ))),
        );
    }

    fn action(&mut self, out: &mut Outbox, action: &Action) {
        match action.name.as_str() {
            "add" => {
                // The direction comes from the payload and the step from the
                // signals; both are user input.
                let Some(dir @ (-1 | 1)) = action.payload_as::<i64>() else {
                    return;
                };
                let step = action
                    .signal("step")
                    .and_then(Value::as_str)
                    .and_then(|s| s.parse().ok())
                    .filter(|s| STEPS.contains(s))
                    .unwrap_or(1);
                self.count = (self.count + dir * step).clamp(-LIMIT, LIMIT);
            }
            "reset" => self.count = 0,
            _ => return,
        }
        out.signal(json!({ "count": self.count }));
    }
}

hypereffect::wasm_app!(Counter);
