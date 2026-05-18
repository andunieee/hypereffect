use hypereffect::server::{App, Loopback};
use hypereffect::{json, Map};
use timer::Timer;

#[test]
fn counts_down() {
    let mut l = Loopback::<Timer>::new(Map::new());
    assert_eq!(l.client.attr("clock", "text"), Some(json!("0:30")));
    assert_eq!(l.client.attr("start", "label"), Some(json!("Start")));
    assert_eq!(l.server.tick_interval(), None);

    l.write("duration", json!(65.0));
    assert!(l.trigger("duration", "onChange"));
    assert_eq!(l.client.attr("clock", "text"), Some(json!("1:05")));

    assert!(l.trigger("start", "onPress"));
    assert_eq!(l.server.tick_interval(), Some(100));
    assert_eq!(l.client.attr("duration", "disabled"), Some(json!(true)));
    l.tick(1000.0);
    l.tick(3500.0);
    assert_eq!(l.client.attr("clock", "text"), Some(json!("1:03")));
    assert_eq!(l.client.attr("bar", "value"), Some(json!(63.0 / 65.0)));
    assert!(l.trigger("lap", "onPress"));
    assert_eq!(l.client.attr("lap-0", "text"), Some(json!("Lap 1: 2 s")));

    assert!(l.trigger("start", "onPress"));
    assert_eq!(l.client.attr("start", "label"), Some(json!("Resume")));
    assert!(l.trigger("start", "onPress"));
    l.tick(10_000.0);
    l.tick(80_000.0);
    assert_eq!(l.client.attr("done", "visible"), Some(json!(true)));
    assert_eq!(l.client.attr("start", "disabled"), Some(json!(true)));
    assert!(l.server.app().unwrap().tick_interval().is_none());

    assert!(l.trigger("reset", "onPress"));
    assert_eq!(l.client.attr("clock", "text"), Some(json!("1:05")));
    assert!(!l.client.contains("lap-0"));
    assert_eq!(l.client.take_diagnostics(), Vec::<String>::new());
}
