use super::{math, model::*};

impl Afterimage {
    pub fn plan(
        &self,
        elapsed: f64,
        duration: f64,
        grain_sample: u64,
        seed: u32,
        width: f64,
        height: f64,
    ) -> Plan {
        let t = elapsed * self.time_scale;
        let duration = duration * self.time_scale;
        let point = |p: [f64; 2]| [p[0] * width, p[1] * height];
        let mut cutout = self.cutout.clone();
        cutout.rect = [
            cutout.rect[0] * width,
            cutout.rect[1] * height,
            cutout.rect[2] * width,
            cutout.rect[3] * height,
        ];
        let mut subtitle = self.subtitle.clone();
        subtitle.position = point(subtitle.position);
        subtitle.font_size *= height;
        subtitle.tracking *= height;
        let mut credit = self.credit.clone();
        credit.position = point(credit.position);
        credit.font_size *= height;
        credit.tracking *= height;
        let fade =
            math::sine((t - 0.75) / 0.8) * (1.0 - math::sine((t - (duration - 0.95)) / 0.75));
        credit.opacity *= if fade > 0.003 { fade } else { 0.0 };
        let intensity = math::rise(t / 0.22)
            * (-t / 1.25).exp()
            * (1.0 + 0.12 * math::noise(t * 2.3, seed.wrapping_add(91))
                - 0.35 * (-((t - 1.55) / 0.07).powi(2)).exp())
            * (1.0 - math::sine((t - (duration - 1.0)) / 0.92));
        let q = (t / 2.2).clamp(0.0, 1.0);
        let m = self.motion_scale;
        let dx = (9.0 * t + 3.0 * (t * 1.3).sin()) * width / 1920.0 * m;
        let dy = (5.0 * t + 2.0 * (t * 0.9 + 1.0).sin()) * height / 1080.0 * m;
        let scale = 1.0 + 0.012 * t * m;
        let angle = 0.004 * t * m;
        let (a, b) = (scale * angle.cos(), scale * angle.sin());
        let transform = [
            a,
            b,
            -b,
            a,
            width / 2.0 + dx - a * width / 2.0 + b * height / 2.0,
            height / 2.0 + dy - b * width / 2.0 - a * height / 2.0,
        ];
        let rasters = [
            ("sharp", "mask", 1.0, 0.0, Some(self.color)),
            ("mid", "sharp", 2.0, 3.0, None),
            ("soft", "sharp", 4.0, 6.0, None),
            ("halo", "sharp", 8.0, 5.0, None),
            ("fringe", "mask", 4.0, 4.0, Some(self.fringe_color)),
        ]
        .into_iter()
        .map(|(id, source, divisor, blur, tint)| Raster {
            id,
            source,
            size: [
                (width / divisor).floor().max(1.0) as u32,
                (height / divisor).floor().max(1.0) as u32,
            ],
            blur: blur * height / 1080.0,
            tint,
        })
        .collect();
        let layers = if intensity > 0.003 {
            [
                ("fringe", 0.5 * (1.0 - q), 10.0, 6.0),
                ("sharp", 0.3 * (1.0 - q), 0.0, 0.0),
                ("mid", 0.7, 0.0, 0.0),
                ("soft", 0.45 + 0.55 * q, 0.0, 0.0),
                ("halo", 0.55, 14.0, 9.0),
            ]
            .into_iter()
            .map(|(raster, gain, x, y)| {
                let x = x * width / 1920.0;
                let y = y * height / 1080.0;
                Layer {
                    raster,
                    opacity: (intensity * gain).min(1.0),
                    rect: [-x, -y, width + 2.0 * x, height + 2.0 * y],
                }
            })
            .collect()
        } else {
            Vec::new()
        };
        Plan {
            mask: Mask {
                cutout,
                title_font: self.title_font.clone(),
                glyphs: self
                    .glyphs
                    .iter()
                    .map(|g| Glyph {
                        text: g.text.clone(),
                        center: point(g.center),
                        font_size: g.font_size * height,
                    })
                    .collect(),
                circle: Circle {
                    center: point(self.circle.center),
                    radius: self.circle.radius * height,
                },
                subtitle,
            },
            background: self.background,
            color: self.color,
            fringe_color: self.fringe_color,
            transform,
            rasters,
            layers,
            grain: math::grain(seed, grain_sample, self.grain),
            credit,
        }
    }
}
