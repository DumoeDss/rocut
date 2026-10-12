use std::io::{self, BufRead, Write};

fn main() {
    let mut output = io::BufWriter::new(io::stdout().lock());
    for line in io::stdin().lock().lines() {
        let json = line.expect("fixture input");
        writeln!(output, "{}", editor_api::sample_particle_surface_json(json)).expect("fixture output");
    }
}
