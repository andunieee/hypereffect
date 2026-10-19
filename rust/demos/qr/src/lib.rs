//! A QR code generator that works on text pasted into it: a link, a Wifi
//! invitation, a payment reference. It encodes the text at the chosen error
//! correction level into an SVG, which it hands to the host as a base64
//! data URI for an image element.

use base64::Engine as _;
use hypereffect::ui::*;
use hypereffect::{cel, json, Action, App, Handler, Map, Outbox, Value};
use qrcode::types::EcLevel;
use qrcode::QrCode;

const SAMPLE: &str = "https://hypereffect.dev";

/// Error correction levels, as offered on the form.
const LEVELS: [(&str, &str, EcLevel); 4] = [
    ("L", "Low (7%)", EcLevel::L),
    ("M", "Medium (15%)", EcLevel::M),
    ("Q", "Quartile (25%)", EcLevel::Q),
    ("H", "High (30%)", EcLevel::H),
];
/// Renderings, as a module size in units of the SVG.
const SIZES: [(&str, &str, f64); 3] = [
    ("small", "Small", 4.0),
    ("medium", "Medium", 6.0),
    ("large", "Large", 9.0),
];
/// The quiet zone around the code, in modules.
const QUIET: f64 = 2.0;

pub struct Qr {
    text: String,
    ecc: usize,
    size: usize,
}

impl Default for Qr {
    fn default() -> Self {
        Qr {
            text: SAMPLE.into(),
            ecc: 1,
            size: 1,
        }
    }
}

impl Qr {
    /// Encodes the current text, filling the `qr` signals with the data URI
    /// and a caption, or with the reason it failed.
    fn encode(&mut self) -> Value {
        if self.text.is_empty() {
            return json!({ "qr": { "src": "", "info": "", "error": "" } });
        }
        match QrCode::with_error_correction_level(self.text.as_bytes(), LEVELS[self.ecc].2) {
            Ok(code) => {
                let svg = Self::svg(&code, SIZES[self.size].2);
                let src = format!(
                    "data:image/svg+xml;base64,{}",
                    base64::engine::general_purpose::STANDARD.encode(svg)
                );
                let version = match code.version() {
                    qrcode::types::Version::Normal(n) => n,
                    qrcode::types::Version::Micro(n) => n,
                };
                json!({
                    "qr": {
                        "src": src,
                        "info": format!(
                            "{} · {}×{} modules · {} bytes",
                            version, code.width(), code.width(), self.text.len()
                        ),
                        "error": "",
                    }
                })
            }
            Err(_) => json!({
                "qr": { "src": "", "info": "", "error": "It is too long for one code." }
            }),
        }
    }

    /// A square SVG: a white background with a black module on every dark
    /// cell, at `scale` units per module plus the quiet zone.
    fn svg(code: &QrCode, scale: f64) -> String {
        let w = code.width();
        let side = (w as f64 + 2.0 * QUIET) * scale;
        let mut rect = String::new();
        for y in 0..w {
            for x in 0..w {
                if code[(x, y)] == qrcode::types::Color::Dark {
                    rect.push_str(&format!(
                        r#"<rect x="{x}" y="{y}" width="1" height="1"/>"#,
                        x = x as f64 + QUIET,
                        y = y as f64 + QUIET,
                    ));
                }
            }
        }
        format!(
            r##"<svg xmlns="http://www.w3.org/2000/svg" width="{side}" height="{side}" viewBox="0 0 {side} {side}"><rect width="{side}" height="{side}" fill="#fff"/><g transform="scale({scale})" fill="#111">{rect}</g></svg>"##,
            side = side,
        )
    }
}

impl App for Qr {
    fn hello(&mut self, out: &mut Outbox, _signals: &Map<String, Value>) {
        out.signal(json!({
            "text": self.text,
            "ecc": LEVELS[self.ecc].0,
            "size": SIZES[self.size].0,
        }));
        let qr = self.encode();
        out.signal(qr);

        out.element(card("qr").title("QR code"));
        out.element(
            input("text")
                .parent("qr")
                .variant("multiline")
                .label("Content")
                .bind("text")
                .on_change(Handler::action("make")),
        );
        out.element(row("options").parent("qr").wrap(true));
        out.element(
            select("ecc")
                .parent("options")
                .label("Error correction")
                .variant("segmented")
                .bind("ecc")
                .options(Value::Array(
                    LEVELS
                        .iter()
                        .map(|(value, label, _)| json!({ "value": value, "label": label }))
                        .collect(),
                ))
                .on_change(Handler::action("make")),
        );
        out.element(
            select("size")
                .parent("options")
                .label("Size")
                .variant("segmented")
                .bind("size")
                .options(Value::Array(
                    SIZES
                        .iter()
                        .map(|(value, label, _)| json!({ "value": value, "label": label }))
                        .collect(),
                ))
                .on_change(Handler::action("make")),
        );
        out.element(
            image("preview")
                .parent("qr")
                .variant("full")
                .src(cel("s.qr.src"))
                .alt("The QR code")
                .visible(cel("s.qr.src != ''")),
        );
        out.element(
            text("info")
                .parent("qr")
                .variant("caption")
                .text(cel("s.qr.info"))
                .visible(cel("s.qr.info != ''")),
        );
        out.element(
            notice("error")
                .parent("qr")
                .variant("failure")
                .title("Could not encode the content")
                .text(cel("s.qr.error"))
                .visible(cel("s.qr.error != ''")),
        );
    }

    fn action(&mut self, out: &mut Outbox, action: &Action) {
        if action.name.as_str() != "make" {
            return;
        }
        if let Some(t) = action.signal("text").and_then(Value::as_str) {
            self.text = t.into();
        }
        if let Some(l) = action.signal("ecc").and_then(Value::as_str) {
            if let Some(n) = LEVELS.iter().position(|(value, ..)| *value == l) {
                self.ecc = n;
            }
        }
        if let Some(s) = action.signal("size").and_then(Value::as_str) {
            if let Some(n) = SIZES.iter().position(|(value, ..)| *value == s) {
                self.size = n;
            }
        }
        out.signal(self.encode());
    }
}

hypereffect::wasm_app!(Qr);
