use hotel::Hotel;
use hypereffect::json;
use hypereffect::server::Loopback;

#[test]
fn quotes_confirms_and_rejects() {
    let mut l = Loopback::<Hotel>::new();
    assert_eq!(
        l.client.attr("total", "text"),
        Some(json!("Total $240")) // 2 nights, no breakfast
    );
    assert_eq!(l.client.attr("left", "text"), Some(json!("6 rooms left")));
    assert_eq!(l.client.attr("left", "variant"), Some(json!("neutral")));

    // The quote follows the slider and the breakfast switch.
    l.write("stay.nights", json!(3.0));
    assert!(l.trigger("nights", "onChange"));
    assert_eq!(l.client.attr("total", "text"), Some(json!("Total $360")));
    l.write("stay.breakfast", json!(true));
    assert!(l.trigger("breakfast", "onChange"));
    assert_eq!(
        l.client.attr("total", "text"),
        Some(json!("Total $402")) // 14 × 3 more
    );

    // Four in a double does not book. Pressing Book only opens the dialog,
    // locally; confirming sends the booking.
    l.write("stay.guests", json!("4"));
    assert!(l.trigger("guests", "onChange"));
    assert!(!l.trigger("book", "onPress"));
    assert_eq!(l.client.attr("confirm", "open"), Some(json!(true)));
    assert!(l.trigger("confirm-yes", "onPress"));
    assert_eq!(l.client.attr("confirm", "open"), Some(json!(false)));
    assert_eq!(l.client.attr("error", "visible"), Some(json!(true)));
    assert_eq!(
        l.client.attr("error", "text"),
        Some(json!(
            "Standard double · $120 a night sleeps 2, and there are 4 of you. \
             The suite is the one made for four."
        ))
    );
    assert_eq!(l.client.attr("confirm", "open"), Some(json!(false)));

    // The suite, with its breakfast, does.
    l.write("stay.room", json!("suite"));
    assert!(l.trigger("room", "onChange"));
    assert_eq!(
        l.client.attr("total", "text"),
        Some(json!("Total $912")) // 290 × 3 + 14 × 3
    );
    assert_eq!(l.client.attr("left", "text"), Some(json!("Last room")));
    assert_eq!(l.client.attr("left", "variant"), Some(json!("warning")));

    // Booking asks first, through a dialog.
    assert!(!l.trigger("book", "onPress"));
    assert_eq!(l.client.attr("confirm", "open"), Some(json!(true)));
    assert_eq!(
        l.client.attr("confirm-text", "text"),
        Some(json!(
            "Corner suite · $290 a night · Fri 23 Oct · 3 nights · 4 guests \
             — a total of $912."
        ))
    );
    assert!(!l.trigger("confirm-no", "onPress"));
    assert_eq!(l.client.attr("confirm", "open"), Some(json!(false)));

    assert!(!l.trigger("book", "onPress"));
    assert!(l.trigger("confirm-yes", "onPress"));
    assert_eq!(l.client.attr("confirm", "open"), Some(json!(false)));
    assert_eq!(l.client.attr("error", "visible"), Some(json!(false)));
    let booked = l
        .client
        .attr("booked", "text")
        .unwrap()
        .as_str()
        .unwrap()
        .to_string();
    assert!(booked.contains("Corner suite"), "{booked}");
    assert!(booked.contains("Fri 23 Oct"), "{booked}");
    // The desk is closed for this stay until the guest starts over.
    assert_eq!(l.client.attr("book", "disabled"), Some(json!(true)));
    assert_eq!(l.client.attr("room", "disabled"), Some(json!(true)));

    assert!(l.trigger("again", "onPress"));
    assert_eq!(l.client.attr("booked", "text"), Some(json!("")));
    assert_eq!(l.client.attr("book", "disabled"), Some(json!(false)));
    assert_eq!(l.client.take_diagnostics(), Vec::<String>::new());
}
