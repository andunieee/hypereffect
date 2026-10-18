use hypereffect::server::Loopback;
use hypereffect::{json, Map};
use psu::{Mode, Psu};

#[test]
fn regulates_and_trips() {
    let mut l = Loopback::<Psu>::new(Map::new());
    assert_eq!(l.client.attr("v-value", "text"), Some(json!("0.00 V")));
    assert_eq!(l.client.attr("mode", "text"), Some(json!("Output off")));
    assert_eq!(l.server.tick_interval(), None);

    // 5 V into the 24 Ω LED strip: constant voltage.
    l.write("out", json!(true));
    assert!(l.trigger("out", "onChange"));
    assert_eq!(l.server.tick_interval(), Some(250));
    for t in 0..10 {
        l.tick(t as f64 * 250.0);
    }
    assert_eq!(l.server.app().unwrap().mode(), Mode::Cv);
    assert_eq!(l.client.attr("mode", "variant"), Some(json!("success")));
    let v: f64 = l.client.attr("v-value", "text").unwrap().as_str().unwrap()[..4]
        .parse()
        .unwrap();
    assert!((v - 5.0).abs() < 0.01, "{v}");

    // A short circuit holds the current at the limit.
    l.write("load", json!("short"));
    assert!(l.trigger("load", "onChange"));
    for t in 10..20 {
        l.tick(t as f64 * 250.0);
    }
    assert_eq!(l.server.app().unwrap().mode(), Mode::Cc);
    assert_eq!(l.client.attr("mode", "variant"), Some(json!("warning")));

    // A preset patches the sliders and sends them.
    assert!(l.trigger("preset-2", "onPress"));
    assert_eq!(l.client.value("set.i").cloned(), Some(json!(2.0)));

    // With protection on, the output turns off.
    l.write("ocp", json!(true));
    assert!(l.trigger("ocp", "onChange"));
    for t in 20..30 {
        l.tick(t as f64 * 250.0);
    }
    assert_eq!(l.client.attr("tripped", "visible"), Some(json!(true)));
    assert_eq!(
        l.client.attr("tripped", "text"),
        Some(json!(
            "The output was turned off when the load reached 2.00 A."
        ))
    );
    assert_eq!(l.client.value("out").cloned(), Some(json!(false)));
    for t in 30..60 {
        l.tick(t as f64 * 250.0);
    }
    assert_eq!(l.client.attr("i-value", "text"), Some(json!("0.000 A")));
    assert_eq!(l.server.tick_interval(), None);
    assert_eq!(l.client.take_diagnostics(), Vec::<String>::new());
}
