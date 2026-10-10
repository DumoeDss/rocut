#[path = "../../rust/crates/editor-api/src/mv_recipe/memories_motion.rs"]
mod motion;
use std::io::{self, Write};
fn number(out: &mut impl Write, v: f64) {
    out.write_all(&v.to_le_bytes()).unwrap();
}
fn main() {
    let mut out = io::BufWriter::new(io::stdout().lock());
    for n in [1, 2, 3, 4, 6, 16] {
        for (i, sl) in motion::slots(n, 45.0).into_iter().enumerate() {
            for v in [sl.x, sl.y, sl.rotation, sl.scale, sl.from[0], sl.from[1]] {
                number(&mut out, v);
            }
            for dt in [-0.43, -0.42, -0.3, -0.01, 0.0, 0.04, 0.3, 1.0] {
                if let Some(p) = motion::pose(sl, i, 10.0, 10.0 + dt) {
                    number(&mut out, 1.0);
                    for v in [
                        p.position[0],
                        p.position[1],
                        p.rotation,
                        p.scale,
                        p.height,
                        p.alpha,
                    ] {
                        number(&mut out, v);
                    }
                    for v in motion::local(p, 302.0, 133.0) {
                        number(&mut out, v);
                    }
                } else {
                    number(&mut out, 0.0);
                }
            }
        }
    }
}
