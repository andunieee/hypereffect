use hypereffect::server::Loopback;
use hypereffect::json;
use qr::Qr;

const DATA: &str = "data:image/svg+xml;base64,";

#[test]
fn encodes_and_rejects() {
    let mut l = Loopback::<Qr>::new();
    let first = l
        .client
        .attr("preview", "src")
        .unwrap()
        .as_str()
        .unwrap()
        .to_string();
    assert!(first.starts_with(DATA), "{first}");
    assert!(l
        .client
        .attr("preview", "visible")
        .unwrap()
        .as_bool()
        .unwrap());
    assert!(l
        .client
        .attr("info", "text")
        .unwrap()
        .as_str()
        .unwrap()
        .contains("modules"));

    // Other content gives a different code.
    l.write("text", json!("HELO, world"));
    assert!(l.trigger("text", "onChange"));
    let second = l
        .client
        .attr("preview", "src")
        .unwrap()
        .as_str()
        .unwrap()
        .to_string();
    assert!(second.starts_with(DATA));
    assert_ne!(first, second);

    // A higher error correction level encodes differently.
    l.write("ecc", json!("H"));
    assert!(l.trigger("ecc", "onChange"));
    let third = l
        .client
        .attr("preview", "src")
        .unwrap()
        .as_str()
        .unwrap()
        .to_string();
    assert_ne!(second, third);

    // Nothing to encode: the image and the caption go away.
    l.write("text", json!(""));
    assert!(l.trigger("text", "onChange"));
    assert_eq!(l.client.attr("preview", "src"), Some(json!("")));
    assert_eq!(l.client.attr("preview", "visible"), Some(json!(false)));
    assert_eq!(l.client.attr("error", "visible"), Some(json!(false)));

    // More data than one code can hold.
    l.write("text", json!(format!("x{}", "y".repeat(4000))));
    assert!(l.trigger("text", "onChange"));
    assert_eq!(l.client.attr("preview", "visible"), Some(json!(false)));
    assert_eq!(l.client.attr("error", "visible"), Some(json!(true)));
    assert_eq!(
        l.client.attr("error", "text"),
        Some(json!("It is too long for one code."))
    );
    assert_eq!(l.client.take_diagnostics(), Vec::<String>::new());
}
