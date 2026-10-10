//! Original paper tooth, blotches and fibres. All seeded raster/geometry in Rust.
use super::super::math::Rng;
use serde::Serialize;
#[derive(Serialize)]
pub struct Blotch {
    pub center: [f64; 2],
    pub radius: f64,
    pub alpha: f64,
}
#[derive(Serialize)]
pub struct Paper {
    pub rgba: String,
    pub blotches: Vec<Blotch>,
    pub fibers: Vec<[[f64; 2]; 3]>,
}
fn range(r: &mut Rng, a: f64, b: f64) -> f64 {
    a + (b - a) * r.next()
}
pub(super) fn plan() -> Paper {
    let mut r = Rng::new(9127.0);
    let mut rgba = Vec::with_capacity(960 * 540 * 4);
    for _ in 0..960 * 540 {
        let v = 238.0 + (r.next() - 0.5) * 26.0 + if r.next() < 0.004 { -40.0 } else { 0.0 };
        for c in [v, v - 3.0, v - 9.0, 255.0] {
            rgba.push(super::super::clamped_byte(c));
        }
    }
    let mut blotches = Vec::new();
    for _ in 0..26 {
        let center = [r.next() * 960.0, r.next() * 540.0];
        let radius = 60.0 + r.next() * 200.0;
        let alpha = 0.12 + r.next() * 0.12;
        blotches.push(Blotch {
            center,
            radius,
            alpha,
        });
    }
    let mut fibers = Vec::new();
    for _ in 0..220 {
        let (x, y, a, l) = (
            r.next() * 960.0,
            r.next() * 540.0,
            r.next() * std::f64::consts::TAU,
            range(&mut r, 6.0, 28.0),
        );
        fibers.push([
            [x, y],
            [x + (a + 0.6).cos() * l * 0.5, y + (a + 0.6).sin() * l * 0.5],
            [x + a.cos() * l, y + a.sin() * l],
        ]);
    }
    Paper {
        rgba: base64(&rgba),
        blotches,
        fibers,
    }
}
fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((bytes.len() + 2) / 3 * 4);
    for c in bytes.chunks(3) {
        let v = (u32::from(c[0]) << 16)
            | (u32::from(*c.get(1).unwrap_or(&0)) << 8)
            | u32::from(*c.get(2).unwrap_or(&0));
        out.push(TABLE[(v >> 18) as usize] as char);
        out.push(TABLE[((v >> 12) & 63) as usize] as char);
        out.push(if c.len() > 1 {
            TABLE[((v >> 6) & 63) as usize] as char
        } else {
            '='
        });
        out.push(if c.len() > 2 {
            TABLE[(v & 63) as usize] as char
        } else {
            '='
        });
    }
    out
}
