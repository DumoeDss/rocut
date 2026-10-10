#[path = "../../rust/crates/editor-api/src/glass_object_params.rs"]
mod glass_object_params;

use std::io::{self, Read};

fn main() -> io::Result<()> {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input)?;
    println!(
        "{}",
        glass_object_params::resolve_glass_object_params_json(input)
    );
    Ok(())
}
