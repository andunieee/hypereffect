//! A hotel's booking desk. The guest picks a room and an arrival day, how
//! long they stay and how many they are, and books: the stay is priced as
//! the terms change, checked against the room's capacity, confirmed in a
//! dialog and answered with a code.

use hypereffect::ui::*;
use hypereffect::{cel, json, Action, App, Handler, Map, Outbox, Value};

/// Rooms, as offered: code, label, rate per night, rooms left, capacity.
const ROOMS: [(&str, &str, f64, u32, u32); 3] = [
    ("standard", "Standard double · $120 a night", 120.0, 6, 2),
    ("deluxe", "Sea-view deluxe · $180 a night", 180.0, 2, 3),
    ("suite", "Corner suite · $290 a night", 290.0, 1, 4),
];
/// Arrival days on the calendar.
const DAYS: [&str; 7] = [
    "Fri 23 Oct",
    "Sat 24 Oct",
    "Sun 25 Oct",
    "Mon 26 Oct",
    "Tue 27 Oct",
    "Wed 28 Oct",
    "Thu 29 Oct",
];
/// Breakfast, per night.
const BREAKFAST: f64 = 14.0;

pub struct Hotel {
    room: usize,
    day: usize,
    nights: u32,
    guests: u32,
    breakfast: bool,
    /// Why the stay cannot be booked, or the empty string.
    problem: String,
    /// The confirmation, or the empty string.
    booked: String,
    noise: u32,
}

impl Default for Hotel {
    fn default() -> Self {
        Hotel {
            room: 0,
            day: 0,
            nights: 2,
            guests: 2,
            breakfast: false,
            problem: String::new(),
            booked: String::new(),
            noise: 7,
        }
    }
}

impl Hotel {
    fn total(&self) -> f64 {
        let rate = ROOMS[self.room].2;
        let nights = self.nights as f64;
        rate * nights
            + if self.breakfast {
                BREAKFAST * nights
            } else {
                0.0
            }
    }

    /// The signals for the stay, the problem and the confirmation.
    fn state(&self) -> Value {
        let (_, label, ..) = ROOMS[self.room];
        let guests = if self.guests == 1 {
            "1 guest".to_string()
        } else {
            format!("{} guests", self.guests)
        };
        let line = format!(
            "{} · {} · {} night{} · {}",
            label,
            DAYS[self.day],
            self.nights,
            if self.nights == 1 { "" } else { "s" },
            guests
        );
        json!({
            "stay": {
                "room": ROOMS[self.room].0,
                "total": format!("${:.0}", self.total()),
                "line": line,
                "left": ROOMS[self.room].3,
            },
            "error": self.problem,
            "booked": self.booked,
        })
    }

    /// A code to name the booking by, like a real desk would hand out.
    fn code(&mut self) -> String {
        self.noise = self.noise.wrapping_mul(1_103_515_245).wrapping_add(12_345);
        format!("HTL-{:04X}", (self.noise >> 16) & 0xFFFF)
    }
}

impl App for Hotel {
    fn hello(&mut self, out: &mut Outbox, _signals: &Map<String, Value>) {
        out.signal(self.state());
        // The dialog's open switch, kept locally by the renderer.
        out.signal(json!({ "_confirm": false }));

        out.element(card("hotel").title("Hotel Caledonia · booking desk"));
        out.element(
            select("room")
                .parent("hotel")
                .label("Room")
                .bind("stay.room")
                .disabled(cel("s.booked != ''"))
                .options(Value::Array(
                    ROOMS
                        .iter()
                        .map(|(value, label, ..)| json!({ "value": value, "label": label }))
                        .collect(),
                ))
                .on_change(Handler::action("room")),
        );
        out.element(
            select("day")
                .parent("hotel")
                .label("Arriving")
                .bind("stay.day")
                .disabled(cel("s.booked != ''"))
                .options(Value::Array(
                    DAYS.iter()
                        .enumerate()
                        .map(|(i, d)| json!({ "value": i.to_string(), "label": d }))
                        .collect(),
                ))
                .on_change(Handler::action("day")),
        );
        out.element(
            slider("nights")
                .parent("hotel")
                .label("Nights")
                .bind("stay.nights")
                .min(1)
                .max(14)
                .step(1)
                .disabled(cel("s.booked != ''"))
                .on_change(Handler::action("nights")),
        );
        out.element(
            select("guests")
                .parent("hotel")
                .label("Guests")
                .variant("segmented")
                .bind("stay.guests")
                .disabled(cel("s.booked != ''"))
                .options(Value::Array(
                    (1..=4u32)
                        .map(|n| {
                            json!({
                                "value": n.to_string(),
                                "label": if n == 1 { "1".to_string() } else { n.to_string() },
                            })
                        })
                        .collect(),
                ))
                .on_change(Handler::action("guests")),
        );
        out.element(
            checkbox("breakfast")
                .parent("hotel")
                .label("Breakfast, $14 a night")
                .bind("stay.breakfast")
                .disabled(cel("s.booked != ''"))
                .on_change(Handler::action("breakfast")),
        );

        out.element(row("quote").parent("hotel").justify("between").wrap(true));
        out.element(
            text("total")
                .parent("quote")
                .variant("h2")
                .text(cel("'Total ' + s.stay.total")),
        );
        out.element(
            badge("left")
                .parent("quote")
                .variant(cel("s.stay.left <= 1 ? 'warning' : 'neutral'"))
                .text(cel(
                    "s.stay.left == 1 ? 'Last room' : string(s.stay.left) + ' rooms left'",
                )),
        );
        out.element(
            notice("error")
                .parent("hotel")
                .variant("failure")
                .title("The room will not fit")
                .text(cel("s.error"))
                .visible(cel("s.error != ''")),
        );
        out.element(
            notice("booked")
                .parent("hotel")
                .variant("success")
                .title("Booked")
                .text(cel("s.booked"))
                .visible(cel("s.booked != ''")),
        );
        out.element(
            button("again")
                .parent("hotel")
                .variant("plain")
                .label("New booking")
                .visible(cel("s.booked != ''"))
                .on_press(Handler::action("again")),
        );
        out.element(
            button("book")
                .parent("hotel")
                .variant("primary")
                .label(cel("'Book · ' + s.stay.total"))
                .disabled(cel("s.booked != '' || s._confirm"))
                .on_press(Handler::patch(json!({ "_confirm": true }))),
        );

        // A dialog stays at the root of the surface, as cards cannot hold one.
        out.element(
            dialog("confirm")
                .title("Confirm the booking")
                .open(cel("s._confirm"))
                .on_dismiss(Handler::patch(json!({ "_confirm": false }))),
        );
        out.element(
            text("confirm-text")
                .parent("confirm")
                .text(cel("s.stay.line + ' — a total of ' + s.stay.total + '.'")),
        );
        out.element(row("confirm-row").parent("confirm").justify("end"));
        out.element(
            button("confirm-no")
                .parent("confirm-row")
                .label("Not yet")
                .on_press(Handler::patch(json!({ "_confirm": false }))),
        );
        out.element(
            button("confirm-yes")
                .parent("confirm-row")
                .variant("primary")
                .label("Book it")
                .on_press(Handler::action("book").with_patch(json!({ "_confirm": false }))),
        );
    }

    fn action(&mut self, out: &mut Outbox, action: &Action) {
        match action.name.as_str() {
            "room" => {
                let code = action.signal("stay.room").and_then(Value::as_str);
                if let Some(n) = ROOMS.iter().position(|r| Some(r.0) == code) {
                    self.room = n;
                }
                self.problem.clear();
            }
            "day" => {
                if let Some(d) = action
                    .signal("stay.day")
                    .and_then(Value::as_str)
                    .and_then(|d| d.parse::<usize>().ok())
                {
                    if d < DAYS.len() {
                        self.day = d;
                    }
                }
            }
            "nights" => {
                if let Some(n) = action.signal("stay.nights").and_then(Value::as_f64) {
                    self.nights = (n.round() as u32).clamp(1, 14);
                }
            }
            "guests" => {
                if let Some(g) = action
                    .signal("stay.guests")
                    .and_then(Value::as_str)
                    .and_then(|g| g.parse::<u32>().ok())
                {
                    self.guests = g.clamp(1, 4);
                }
            }
            "breakfast" => {
                self.breakfast = action
                    .signal("stay.breakfast")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
            }
            "book" => {
                self.problem.clear();
                let (_, label, .., sleeps) = ROOMS[self.room];
                if self.guests > sleeps {
                    self.problem = format!(
                        "{label} sleeps {sleeps}, and there are {} of you. The suite is the one \
                         made for four.",
                        self.guests
                    );
                } else {
                    let (day, nights, guests) = (self.day, self.nights, self.guests);
                    let code = self.code();
                    self.booked = format!(
                        "{label} is your room — {}, {} night{}, {}. Code {}.",
                        DAYS[day],
                        nights,
                        if nights == 1 { "" } else { "s" },
                        if guests == 1 {
                            "1 guest".to_string()
                        } else {
                            format!("{guests} guests")
                        },
                        code
                    );
                }
            }
            "again" => {
                self.booked.clear();
                self.problem.clear();
            }
            _ => {}
        }
        out.signal(self.state());
    }
}

hypereffect::wasm_app!(Hotel);
