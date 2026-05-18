use counter::Counter;
use hypereffect::server::Loopback;
use hypereffect::{json, Map};

#[test]
fn counts_by_step() {
    let mut l = Loopback::<Counter>::new(Map::new());
    assert_eq!(l.client.attr("value", "text"), Some(json!("Count: 0")));
    assert_eq!(l.client.attr("zero", "visible"), Some(json!(true)));
    assert_eq!(l.client.attr("reset", "disabled"), Some(json!(true)));
    assert!(l.trigger("inc", "onPress"));
    l.write("step", json!("10"));
    assert_eq!(l.client.attr("inc", "label"), Some(json!("+ 10")));
    assert!(l.trigger("inc", "onPress"));
    assert_eq!(l.client.attr("value", "text"), Some(json!("Count: 11")));
    assert!(l.trigger("dec", "onPress"));
    assert_eq!(l.client.attr("value", "text"), Some(json!("Count: 1")));
    assert_eq!(l.client.attr("zero", "visible"), Some(json!(false)));
    for _ in 0..9 {
        l.trigger("inc", "onPress");
    }
    assert_eq!(l.client.attr("value", "text"), Some(json!("Count: 91")));
    assert_eq!(l.client.attr("inc", "disabled"), Some(json!(true)));
    assert!(!l.trigger("inc", "onPress"));
    assert!(l.trigger("reset", "onPress"));
    assert_eq!(l.client.attr("value", "text"), Some(json!("Count: 0")));
    assert_eq!(l.client.take_diagnostics(), Vec::<String>::new());
}
