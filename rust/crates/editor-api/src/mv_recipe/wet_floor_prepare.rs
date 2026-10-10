use super::{
    canvas::{Canvas, Op, Surface},
    math::*,
    model::Image,
};
use sha2::{Digest, Sha256};
pub struct ReflectionMask {
    pub(super) image_id: String,
    pub(super) image_sha256: String,
    pub(super) image_size: [u32; 2],
    pub(super) alpha: Vec<u8>,
    pub(super) sampled_rgba_sha256: String,
}
/// Canvas2D must first draw the actual admitted decoded image to 418x235 and
/// read its real RGBA pixels. Rust alone performs the upstream mask analysis.
pub fn prepare_reflection_mask(image: &Image, rgba_bytes: &[u8]) -> Result<ReflectionMask, String> {
    if image.resource.kind != "image"
        || !(1..=8192).contains(&image.width)
        || !(1..=8192).contains(&image.height)
        || rgba_bytes.len() != 418 * 235 * 4
    {
        return Err("wetFloor reflection sample identity/dimensions mismatch".into());
    }
    let hz = 518.0 / 941.0 * 235.0 + 1.0;
    let mut alpha = Vec::with_capacity(418 * 235);
    for y in 0..235 {
        for x in 0..418 {
            let i = (y * 418 + x) * 4;
            let rgb = &rgba_bytes[i..i + 3];
            let mx = *rgb.iter().max().unwrap() as f64 / 255.0;
            let mn = *rgb.iter().min().unwrap() as f64 / 255.0;
            let a = if (y as f64) < hz {
                0.0
            } else {
                (smooth(0.2, 0.42, mx) + smooth(0.12, 0.3, mx - mn) * 0.8).min(1.0)
                    * smooth(hz, hz + 6.0, y as f64)
            };
            alpha.push(byte(a * 255.0));
        }
    }
    Ok(ReflectionMask {
        image_id: image.resource.id.clone(),
        image_sha256: image.resource.sha256().to_string(),
        image_size: [image.width, image.height],
        alpha,
        sampled_rgba_sha256: format!("{:x}", Sha256::digest(rgba_bytes)),
    })
}
pub fn mask_surfaces(mask: &ReflectionMask) -> Vec<Surface> {
    let raw = Surface {
        id: "reflection-mask-raw".into(),
        size: [418, 235],
        operations: vec![Op::PutAlpha {
            size: [418, 235],
            bytes: mask.alpha.clone(),
        }],
    };
    let mut c = Canvas::new("reflection-mask");
    c.filter("blur(1.5px)");
    c.blit("reflection-mask-raw", None, [0.0, 0.0, 418.0, 235.0]);
    vec![
        raw,
        Surface {
            id: "reflection-mask".into(),
            size: [418, 235],
            operations: c.ops,
        },
    ]
}
pub fn asphalt() -> Surface {
    let mut bytes = Vec::with_capacity(1056 * 594 * 4);
    for y in 0..594 {
        for x in 0..1056 {
            let (x, y) = (x as f64, y as f64);
            let mut n = (0.32 * rnd(&[(x / 8.0).floor(), (y / 8.0).floor(), 1.0])
                + 0.3 * rnd(&[(x / 4.0).floor(), (y / 4.0).floor(), 2.0])
                + 0.22 * rnd(&[(x / 2.0).floor(), (y / 2.0).floor(), 3.0])
                + 0.16 * rnd(&[x, y, 4.0]))
            .powf(2.1);
            let s = rnd(&[(x / 2.0).floor(), (y / 2.0).floor(), 9.0]);
            if s > 0.986 {
                n = (n + 0.38).min(1.0)
            } else if s < 0.012 {
                n *= 0.25
            }
            for (a, b) in [(11.0, 86.0), (13.0, 92.0), (21.0, 112.0)] {
                bytes.push(byte(a + (b - a) * n));
            }
            bytes.push(255);
        }
    }
    Surface {
        id: "asphalt-noise".into(),
        size: [1056, 594],
        operations: vec![Op::PutRgba {
            size: [1056, 594],
            bytes,
        }],
    }
}
