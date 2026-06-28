use hypereffect::server::Loopback;
use hypereffect::{json, Map};
use import::Import;

#[test]
fn maps_columns_and_imports() {
    let mut l = Loopback::<Import>::new(Map::new());
    // Columns are guessed from the header; first and last name are joined.
    assert_eq!(l.client.attr("col-0", "label"), Some(json!("First name")));
    assert_eq!(l.client.value("map.c0"), Some(&json!("name")));
    assert_eq!(l.client.value("map.c2"), Some(&json!("email")));
    assert_eq!(
        l.client.attr("r0-text", "text"),
        Some(json!("Ada Lovelace · ada@analytical.org · +44 20 7946 0018 · Analytical Engines"))
    );
    assert_eq!(l.client.attr("r2-badge", "text"), Some(json!("invalid email")));
    assert_eq!(l.client.attr("r3-badge", "text"), Some(json!("no name")));
    assert_eq!(l.client.attr("r0-badge", "visible"), Some(json!(false)));
    assert_eq!(l.client.attr("summary", "text"), Some(json!("6 rows, 2 will be skipped")));
    assert_eq!(l.client.attr("go", "label"), Some(json!("Import 4 contacts")));

    // Not importing the email column makes Alan's row valid.
    l.write("map.c2", json!("skip"));
    assert!(l.trigger("col-2", "onChange"));
    assert_eq!(l.client.attr("r2-badge", "visible"), Some(json!(false)));
    assert_eq!(l.client.attr("go", "label"), Some(json!("Import 5 contacts")));

    // Fewer columns and rows remove the extra dropdowns and preview rows.
    l.write("csv", json!("Name;Mail\nAda;ada@example.org"));
    assert!(l.trigger("csv", "onChange"));
    assert!(l.client.contains("col-1"));
    assert!(!l.client.contains("col-2"));
    assert_eq!(l.client.value("map.c2"), None);
    assert_eq!(l.client.value("map.c1"), Some(&json!("email")));
    assert!(!l.client.contains("r1"));
    assert_eq!(l.client.attr("go", "label"), Some(json!("Import 1 contact")));

    l.write("csv", json!("Name,Email\nA,a@x.org\nB,b@x.org"));
    assert!(l.trigger("csv", "onChange"));
    assert!(l.trigger("go", "onPress"));
    assert_eq!(l.client.attr("progress", "visible"), Some(json!(true)));
    assert_eq!(l.client.attr("csv", "disabled"), Some(json!(true)));
    l.tick(0.0);
    assert_eq!(l.client.attr("progress", "label"), Some(json!("Importing 1 of 2")));
    l.tick(400.0);
    assert_eq!(l.client.attr("done", "visible"), Some(json!(true)));
    assert_eq!(l.client.attr("done", "text"), Some(json!("2 contacts were added.")));
    assert_eq!(l.client.attr("go", "disabled"), Some(json!(true)));
    assert_eq!(l.server.tick_interval(), None);
    assert_eq!(l.client.take_diagnostics(), Vec::<String>::new());
}
