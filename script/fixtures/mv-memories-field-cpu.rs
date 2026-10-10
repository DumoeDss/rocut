#[path = "../../rust/crates/editor-api/src/mv_recipe/memories_field.rs"]
mod field;
use std::io::{self, Write};
fn main() {
    let mut out = io::stdout().lock();
    for (seed, hero, face) in [
        (45.0, false, None),
        (
            52.0,
            true,
            Some([
                (20.0 + 1040.0 * 0.665 / 2.0) / 560.0,
                (20.0 + 650.0 * 0.3 / 2.0) / 431.0,
            ]),
        ),
    ] {
        let f = field::build(seed, hero, face);
        out.write_all(&f.face_level.to_le_bytes()).unwrap();
        for v in f.values.iter().chain(&f.patches) {
            out.write_all(&v.to_le_bytes()).unwrap();
        }
        for p in f.ash.iter().chain(&f.sparks) {
            for v in [p.uv[0], p.uv[1], p.field, p.k as f64] {
                out.write_all(&v.to_le_bytes()).unwrap();
            }
        }
        for (b, t) in [(-0.02, 4.0), (0.2, 5.0), (0.7, 6.0), (1.06, 7.0)] {
            let bytes = field::render(&f, b, t).unwrap();
            out.write_all(&bytes.keep).unwrap();
            out.write_all(&bytes.over).unwrap();
            out.write_all(&bytes.glow).unwrap();
        }
    }
}
