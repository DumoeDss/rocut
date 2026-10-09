use super::{clock::Clock, draw::*, math::*, model::Fall, plan::*, raster::*};
use crate::mv_image_dimensions::Context;
pub(super) struct Character {
    pub size: [u32; 2],
    pub scale: f64,
    pub rotation: f64,
    pub position: [f64; 2],
}
impl Character {
    pub fn new(a: &Fall, c: &Clock, images: &Context) -> Result<Self, String> {
        let image = images.image(&a.image)?;
        if (image.height as f64 * 0.24).round() == 0.0 {
            return Err("fall character needs a nonzero rounded hair split".into());
        }
        Ok(Self {
            size: [image.width, image.height],
            scale: a.h / image.height as f64,
            rotation: 0.05 - 0.07 * sine(c.progress) + 0.012 * (c.quantized * 1.2).sin(),
            position: [
                960.0 + fbm(c.held * 0.45, 3.0) * 24.0,
                610.0 + fbm(c.held * 0.38, 9.0) * 18.0,
            ],
        })
    }
    pub fn map(&self, p: [f64; 2]) -> [f64; 2] {
        let dx = (p[0] - 448.0) * self.scale;
        let dy = (p[1] - 812.0) * self.scale;
        let (sn, c) = self.rotation.sin_cos();
        [
            self.position[0] + dx * c - dy * sn,
            self.position[1] + dx * sn + dy * c,
        ]
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
            offset: [-448.0, -812.0],
        });
    }
    pub fn rect(&self) -> [f64; 4] {
        [0.0, 0.0, self.size[0] as f64, self.size[1] as f64]
    }
    pub fn strips(&self, time: f64, amp: f64) -> Vec<([f64; 4], [f64; 4])> {
        let w = self.size[0] as f64;
        let h = self.size[1] as f64;
        let sy = (h * 0.24).round();
        let body = [0.0, sy, w, h - sy];
        let mut strips = vec![(body, body)];
        for i in 0..30 {
            let y0 = (sy * i as f64 / 30.0).round();
            let y1 = (sy * (i + 1) as f64 / 30.0).round();
            let vm = (y0 + y1) / 2.0 / sy;
            let k = (1.0 - vm).powf(1.6);
            let dx = amp * k * (TAU * 1.4 * (1.0 - vm) - time * 8.0).sin()
                + amp * 0.4 * k * (time * 2.3 + vm * 4.0).sin();
            strips.push(([0.0, y0, w, y1 - y0 + 1.0], [dx, y0, w, y1 - y0 + 1.0]));
        }
        strips
    }
}
pub(super) fn prepare(out: &mut Vec<Command>, a: &Fall, c: &Clock, h: &Character, v: f64) {
    let mut mask = Draw::new(1920.0, 1080.0);
    mask.operations = c.camera();
    mask.operations.push(Operation::CopyTransform);
    h.apply(&mut mask);
    for (src, dst) in h.strips(c.quantized, 12.0 + 7.0 * v) {
        image(&mut mask, &a.image, Some(src), dst, "low");
    }
    surface(out, "fa-mask", [1920, 1080], mask);
    let mut lit = Draw::new(1920.0, 1080.0);
    all(
        &mut lit,
        "fa-mask",
        [1920, 1080],
        FRAME,
        "source-over",
        1.0,
        0.0,
    );
    lit.operations = c.camera();
    lit.operations.push(Operation::CopyTransform);
    let shade = linear(
        [0.0, h.map([448.0, 150.0])[1]],
        [0.0, h.map([448.0, 1600.0])[1]],
        &[
            (0.0, rgb(8, 18, 31, 0.1)),
            (0.45, rgb(8, 18, 31, 0.4)),
            (1.0, rgb(4, 9, 17, 0.78)),
        ],
    );
    lit.rect(super::background::COVER, fill(shade, "source-atop"));
    lit.rect(
        super::background::COVER,
        fill(solid(rgb(20, 58, 86, 0.24)), "source-atop"),
    );
    surface(out, "fa-lit", [1920, 1080], lit);
    release(out, "fa-mask");
    for (tint, rim, y, col) in [
        ("fa-warm-tint", "fa-warm", 10.0, rgb(255, 200, 144, 1.0)),
        ("fa-cold-tint", "fa-cold", -9.0, rgb(111, 184, 232, 1.0)),
    ] {
        let mut d = Draw::new(1920.0, 1080.0);
        image(&mut d, &a.image, None, h.rect(), "low");
        d.rect(h.rect(), fill(solid(col), "source-in"));
        surface(out, tint, h.size, d);
        let mut d = Draw::new(1920.0, 1080.0);
        all(&mut d, tint, h.size, h.rect(), "source-over", 1.0, 0.0);
        d.commands.push(Command::Image {
            image: a.image.clone(),
            source_rect: None,
            destination_rect: [0.0, y, h.size[0] as f64, h.size[1] as f64],
            transform: I,
            operations: vec![],
            clip: None,
            composite: "destination-out",
            opacity: 1.0,
            smoothing: true,
            smoothing_quality: "low",
        });
        surface(out, rim, h.size, d);
        release(out, tint);
    }
}
pub(super) fn draw(d: &mut Draw, c: &Clock, h: &Character, v: f64) {
    let camera = d.operations.clone();
    d.operations.clear();
    all(d, "fa-lit", [1920, 1080], FRAME, "source-over", 1.0, 0.0);
    for (id, comp, alpha, blur) in [
        ("fa-warm", "source-over", 0.55 + 0.45 * c.pulse, 0.0),
        ("fa-cold", "source-over", 0.45, 0.0),
        ("fa-warm", "lighter", 0.45 + 0.5 * c.pulse, 5.0),
        ("fa-cold", "lighter", 0.3, 5.0),
    ] {
        d.operations = camera.clone();
        h.apply(d);
        // The original filter applies to each of the 31 drawImage calls.
        for (src, dst) in h.strips(c.quantized, 12.0 + 7.0 * v) {
            blit(d, id, src, dst, comp, alpha, blur);
        }
    }
    d.operations = camera;
}
