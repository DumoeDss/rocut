// Private probe entry: uses the same exported policy as the WASM bridge,
// without synchronizing or modifying the installed shared WASM package.
fn main() {
    let mut args = std::env::args();
    args.next();
    let input = args.next().expect("Expected one JSON video export request");
    assert!(
        args.next().is_none(),
        "Expected one JSON video export request"
    );
    println!("{}", editor_api::resolve_video_export_json(input));
}
