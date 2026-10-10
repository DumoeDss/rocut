use super::{background::linear, clock::Clock, draw::*, math::*, model::Ink, plan::*, raster::*};
use crate::mv_image_dimensions::Context;
pub(super) struct Character {
    pub size: [u32; 2],
    pub scale: f64,
}
impl Character {
    pub fn new(a: &Ink, images: &Context) -> Result<Self, String> {
        let image = images.image(&a.char)?;
        Ok(Self {
            size: [image.width, image.height],
            scale: a.h / image.height as f64,
        })
    }
    fn pose(&self, a: &Ink, c: &Clock) -> Vec<Operation> {
        vec![
            Operation::Translate { offset: [a.x, a.y] },
            Operation::Scale {
                factors: [
                    self.scale,
                    self.scale * (1.0 + 0.004 * (c.quantized * 1.7).sin()),
                ],
            },
        ]
    }
    fn rect(&self) -> [f64; 4] {
        [
            -(self.size[0] as f64) / 2.,
            -(self.size[1] as f64),
            self.size[0] as f64,
            self.size[1] as f64,
        ]
    }
    pub fn draw(&self, out: &mut Vec<Command>, a: &Ink, c: &Clock) {
        let mut mask = Draw::new(1920., 1080.);
        mask.operations = c.camera();
        mask.operations.push(Operation::CopyTransform);
        mask.operations.extend(self.pose(a, c));
        image(&mut mask, &a.char, self.rect(), "source-over");
        surface(out, "ik-char-mask", [1920, 1080], mask);
        let mut lit = Draw::new(1920., 1080.);
        all(
            &mut lit,
            "ik-char-mask",
            [1920, 1080],
            FRAME,
            "source-over",
            1.,
            0.,
        );
        lit.operations = c.camera();
        lit.operations.push(Operation::CopyTransform);
        lit.rect(
            COVER,
            fill(
                linear(
                    [0., a.y - self.size[1] as f64 * self.scale],
                    [0., a.y],
                    &[
                        (0., rgb(60, 54, 62, 0.12)),
                        (0.55, rgb(46, 40, 50, 0.24)),
                        (1., rgb(14, 12, 17, 0.6)),
                    ],
                ),
                "source-atop",
            ),
        );
        surface(out, "ik-char-lit", [1920, 1080], lit);
        release(out, "ik-char-mask");
        let mut scene = Draw::new(1920., 1080.);
        all(
            &mut scene,
            "ik-char-lit",
            [1920, 1080],
            FRAME,
            "source-over",
            1.,
            0.,
        );
        append(out, "ik-scene", scene);
        release(out, "ik-char-lit");
        let rect = [0., 0., self.size[0] as f64, self.size[1] as f64];
        let mut tint = Draw::new(1920., 1080.);
        image(&mut tint, &a.char, rect, "source-over");
        tint.rect(rect, fill(solid(rgb(255, 194, 122, 1.)), "source-in"));
        surface(out, "ik-rim-tint", self.size, tint);
        let mut rim = Draw::new(1920., 1080.);
        all(
            &mut rim,
            "ik-rim-tint",
            self.size,
            rect,
            "source-over",
            1.,
            0.,
        );
        image(
            &mut rim,
            &a.char,
            [-9., 7., rect[2], rect[3]],
            "destination-out",
        );
        surface(out, "ik-rim", self.size, rim);
        release(out, "ik-rim-tint");
        let mut scene = Draw::new(1920., 1080.);
        scene.operations = c.camera();
        scene.operations.extend(self.pose(a, c));
        all(
            &mut scene,
            "ik-rim",
            self.size,
            self.rect(),
            "source-over",
            0.95,
            0.,
        );
        all(
            &mut scene,
            "ik-rim",
            self.size,
            self.rect(),
            "lighter",
            0.55,
            5.,
        );
        append(out, "ik-scene", scene);
        release(out, "ik-rim");
    }
}
