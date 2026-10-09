use super::{clock::Clock, draw::*, math::*, model::Thread, plan::*, raster::*, state::State};
use crate::mv_image_dimensions::Context;

pub(super) struct Hand {
    pub size: [u32; 2],
    pub scale: f64,
    pub rotation: f64,
    pub position: [f64; 2],
}
impl Hand {
    pub fn new(a: &Thread, c: &Clock, images: &Context) -> Result<Self, String> {
        let dim = images.image(&a.hand)?;
        let rotation = a.hand_rot
            + 0.035 * sine(inv(c.start, c.end, c.quantized))
            + 0.007 * (c.quantized * 1.9).sin()
            + 0.012
                * if c.time >= c.kick {
                    (-(c.time - c.kick) * 4.0).exp()
                } else {
                    0.0
                };
        Ok(Self {
            size: [dim.width, dim.height],
            scale: a.hand_h / dim.height as f64,
            rotation,
            position: [a.hand_x, a.hand_y],
        })
    }
    pub fn map(&self, p: [f64; 2]) -> [f64; 2] {
        let dx = (p[0] - 230.0) * self.scale;
        let dy = (p[1] - 1480.0) * self.scale;
        let (sn, c) = self.rotation.sin_cos();
        [
            self.position[0] + dx * c - dy * sn,
            self.position[1] + dx * sn + dy * c,
        ]
    }
    pub fn dir(&self, p: [f64; 2]) -> [f64; 2] {
        let (sn, c) = self.rotation.sin_cos();
        [p[0] * c - p[1] * sn, p[0] * sn + p[1] * c]
    }
    fn apply(&self, d: &mut Draw) {
        d.operations.push(Operation::Translate {
            offset: self.position,
        });
        if self.rotation != 0.0 {
            d.operations.push(Operation::Rotate {
                radians: self.rotation,
            });
        }
        d.operations.push(Operation::Scale {
            factors: [self.scale, self.scale],
        });
        d.operations.push(Operation::Translate {
            offset: [-230.0, -1480.0],
        });
    }
    pub fn rect(&self) -> [f64; 4] {
        [0.0, 0.0, self.size[0] as f64, self.size[1] as f64]
    }
}
pub(super) fn prepare(out: &mut Vec<Command>, a: &Thread, s: &State, h: &Hand) {
    let mut mask = Draw::new(1920.0, 1080.0);
    mask.operations = s.camera(1.0);
    mask.operations.push(Operation::CopyTransform);
    h.apply(&mut mask);
    image(&mut mask, &a.hand, None, h.rect(), "low");
    surface(out, "th-mask", [1920, 1080], mask);
    let mut lit = Draw::new(1920.0, 1080.0);
    all(
        &mut lit,
        "th-mask",
        [1920, 1080],
        FRAME,
        "source-over",
        1.0,
        0.0,
    );
    lit.operations = s.camera(1.0);
    lit.operations.push(Operation::CopyTransform);
    let shade = linear(
        a.light,
        [80.0, 1120.0],
        &[
            (0.0, rgb(26, 8, 36, 0.0)),
            (0.6, rgb(26, 8, 36, 0.16)),
            (1.0, rgb(14, 5, 22, 0.62)),
        ],
    );
    lit.rect(super::background::COVER, fill(shade, "source-atop"));
    lit.rect(
        super::background::COVER,
        fill(solid(rgb(92, 40, 120, 0.12)), "source-atop"),
    );
    surface(out, "th-lit", [1920, 1080], lit);
    release(out, "th-mask");
    let mut tint = Draw::new(1920.0, 1080.0);
    image(&mut tint, &a.hand, None, h.rect(), "low");
    tint.rect(h.rect(), fill(solid(rgb(255, 176, 138, 1.0)), "source-in"));
    surface(out, "th-hand-tint", h.size, tint);
    let mut rim = Draw::new(1920.0, 1080.0);
    all(
        &mut rim,
        "th-hand-tint",
        h.size,
        h.rect(),
        "source-over",
        1.0,
        0.0,
    );
    rim.commands.push(Command::Image {
        image: a.hand.clone(),
        source_rect: None,
        destination_rect: [-7.0, 6.0, h.size[0] as f64, h.size[1] as f64],
        transform: I,
        operations: vec![],
        clip: None,
        composite: "destination-out",
        opacity: 1.0,
        smoothing: true,
        smoothing_quality: "low",
    });
    surface(out, "th-rim", h.size, rim);
    release(out, "th-hand-tint");
}
pub(super) fn draw(d: &mut Draw, s: &State, h: &Hand) {
    let camera = d.operations.clone();
    d.operations.clear();
    all(d, "th-lit", [1920, 1080], FRAME, "source-over", 1.0, 0.0);
    d.operations = camera.clone();
    h.apply(d);
    all(
        d,
        "th-rim",
        h.size,
        h.rect(),
        "source-over",
        0.5 + 0.3 * s.light_pulse,
        0.0,
    );
    all(
        d,
        "th-rim",
        h.size,
        h.rect(),
        "lighter",
        0.35 + 0.3 * s.light_pulse,
        4.0,
    );
    d.operations = camera;
}
