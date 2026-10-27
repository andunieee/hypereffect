use hypereffect::json;
use hypereffect::server::Loopback;
use todos::Todos;

#[test]
fn add_toggle_delete_clear() {
    let mut l = Loopback::<Todos>::new();
    let c = &l.client;
    assert_eq!(c.children(Some("items")), ["t1", "t2", "t3"]);
    assert_eq!(c.attr("left", "text"), Some(json!("2 of 3 left")));
    assert_eq!(c.attr("add", "disabled"), Some(json!(true)));

    l.write("new", json!("  Buy milk "));
    assert_eq!(l.client.attr("add", "disabled"), Some(json!(false)));
    assert!(l.trigger("new", "onSubmit"));
    assert_eq!(l.client.children(Some("items")), ["t4", "t1", "t2", "t3"]);
    assert_eq!(l.client.attr("t4-check", "label"), Some(json!("Buy milk")));
    assert_eq!(l.client.value("new"), Some(&json!("")));
    assert_eq!(l.client.value("_adding"), Some(&json!(false)));

    // Filters are local: no action, only visibility changes.
    l.write("_filter", json!("done"));
    assert_eq!(l.client.attr("t1", "visible"), Some(json!(true)));
    assert_eq!(l.client.attr("t4", "visible"), Some(json!(false)));
    l.write("_filter", json!("all"));

    l.write("done.t4", json!(true));
    assert!(l.trigger("t4-check", "onChange"));
    assert_eq!(l.client.attr("left", "text"), Some(json!("2 of 4 left")));

    assert!(l.trigger("t2-del", "onPress"));
    assert!(!l.client.contains("t2"));
    assert!(!l.client.contains("t2-check"));
    assert_eq!(l.client.value("done.t2"), None);

    assert_eq!(l.client.attr("confirm", "open"), Some(json!(false)));
    assert!(!l.trigger("clear", "onPress"));
    assert_eq!(l.client.attr("confirm", "open"), Some(json!(true)));
    assert_eq!(
        l.client.attr("confirm-text", "text"),
        Some(json!("2 tasks will be deleted."))
    );
    assert!(l.trigger("confirm-yes", "onPress"));
    assert_eq!(l.client.attr("confirm", "open"), Some(json!(false)));
    assert_eq!(l.client.children(Some("items")), ["t3"]);
    assert_eq!(l.client.attr("clear", "disabled"), Some(json!(true)));
    assert_eq!(l.client.take_diagnostics(), Vec::<String>::new());
}
