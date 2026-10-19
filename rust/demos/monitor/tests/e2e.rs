use hypereffect::server::Loopback;
use hypereffect::{json, Map};
use monitor::Monitor;

#[test]
fn logs_drifts_and_alarms() {
    let mut l = Loopback::<Monitor>::new(Map::new());
    assert_eq!(l.client.attr("t-value", "text"), Some(json!("21.0 °C")));
    assert_eq!(l.client.attr("a-value", "text"), Some(json!("—")));
    assert_eq!(l.client.attr("c-value", "text"), Some(json!("0")));
    assert_eq!(l.client.attr("clear", "disabled"), Some(json!(true)));
    assert_eq!(l.server.tick_interval(), None);

    // Going online logs a reading every half second.
    l.write("online", json!(true));
    assert!(l.trigger("online", "onChange"));
    assert_eq!(l.server.tick_interval(), Some(500));
    for t in 0..10 {
        l.tick(t as f64 * 500.0);
    }
    assert_eq!(l.client.attr("c-value", "text"), Some(json!("10")));
    // The window keeps eight rows and lets the oldest fall off.
    assert!(!l.client.contains("log-1"));
    assert!(l.client.contains("log-2"));
    assert!(l.client.contains("log-9"));
    assert!(l.client.attr("log-9-t", "text").is_some());

    // On to the hot device: readings climb toward 60 °C.
    l.write("device", json!("printer"));
    assert!(l.trigger("device", "onChange"));
    l.write("alarm", json!(45.0));
    assert!(l.trigger("alarm", "onChange"));
    for t in 10..40 {
        l.tick(t as f64 * 500.0);
    }
    assert_eq!(l.client.attr("alarm", "visible"), Some(json!(true)));
    assert_eq!(l.client.attr("level", "variant"), Some(json!("failure")));
    assert_eq!(
        l.client.attr("level", "text"),
        Some(json!("Above the alarm"))
    );
    assert_eq!(l.client.attr("log-39-b", "text"), Some(json!("hot")));

    // Clearing the log empties the surface and the statistics.
    let shown: Vec<String> = (10..40)
        .filter(|i| l.client.contains(&format!("log-{i}")))
        .map(|i| format!("log-{i}"))
        .collect();
    assert!(!shown.is_empty());
    assert!(l.trigger("clear", "onPress"));
    for id in shown {
        assert!(!l.client.contains(&id), "{id}");
    }
    assert_eq!(l.client.attr("c-value", "text"), Some(json!("0")));
    assert_eq!(l.client.attr("clear", "disabled"), Some(json!(true)));
    l.tick(40.0 * 500.0);
    assert_eq!(l.client.attr("c-value", "text"), Some(json!("1")));
    assert_eq!(
        l.client.attr("log-40-b", "text"),
        Some(json!("hot")) // it is still near 60 °C
    );
    assert_eq!(l.client.take_diagnostics(), Vec::<String>::new());
}
