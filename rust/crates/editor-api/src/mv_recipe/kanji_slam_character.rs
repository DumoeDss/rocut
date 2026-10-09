use super::{
    clock::Clock,
    draw::*,
    math::*,
    model::{Axis, KanjiSlam},
    palette::*,
    plan::*,
    raster::*,
    state::State,
};
use crate::mv_image_dimensions::Context;
pub(super) struct Character {
    pub image: [u32; 2],
    pub size: [u32; 2],
    pub pad: [f64; 2],
    pub face: [f64; 2],
    pub x: f64,
    pub y: f64,
    pub h: f64,
    pub bob: f64,
}
impl Character {
    pub fn new(a: &KanjiSlam, c: &Clock, images: &Context) -> Result<Self, String> {
        let image = images.image(&a.character)?;
        let width = image.width as f64;
        let height = image.height as f64;
        let padding = (a.wind.amp * 1.6).ceil() + 2.0;
        let pad = if a.wind.axis == Axis::Col {
            [0.0, padding]
        } else {
            [padding, 0.0]
        };
        let size = [
            image.width + 2 * pad[0] as u32,
            image.height + 2 * pad[1] as u32,
        ];
        if size.iter().any(|n| *n > 4096) {
            return Err("kanjiSlam padded character exceeds4096surface bound".into());
        }
        let scale = a.char_h / height;
        let face = [
            a.char_x + (a.face[0] - 0.5) * width * scale,
            a.char_y - (1.0 - a.face[1]) * a.char_h,
        ];
        let f = &a.frames[c.hit % a.frames.len()];
        let z = f.z * (1.0 + 0.02 * c.elapsed.min(0.8));
        Ok(Self {
            image: [image.width, image.height],
            size,
            pad,
            face,
            x: face[0] + (a.char_x - face[0]) * z + f.dx,
            y: face[1] + (a.char_y - face[1]) * z + f.dy,
            h: a.char_h * z,
            bob: (quant(c.time, 12.0) * 2.1).sin() * 4.0,
        })
    }
    pub fn draw(
        &self,
        d: &mut Draw,
        id: &'static str,
        x: f64,
        y: f64,
        alpha: f64,
        comp: &'static str,
    ) {
        let scale = self.h / self.image[1] as f64;
        let width = self.image[0] as f64 * scale;
        // Canvas ignores out-of-range globalAlpha assignment; drawWarped starts
        // from the surrounding alpha of one, including high fire rim presets.
        let alpha = if (0.0..=1.0).contains(&alpha) {
            alpha
        } else {
            1.0
        };
        all(
            d,
            id,
            self.size,
            [
                x - width * 0.5 - self.pad[0] * scale,
                y - self.h - self.pad[1] * scale,
                self.size[0] as f64 * scale,
                self.size[1] as f64 * scale,
            ],
            comp,
            alpha,
            0.0,
        );
    }
}
fn warp(
    out: &mut Vec<Command>,
    a: &KanjiSlam,
    c: &Clock,
    g: &Character,
    id: &'static str,
    source: Option<&'static str>,
) {
    let mut d = Draw::new(1920.0, 1080.0);
    let w = g.image[0] as f64;
    let h = g.image[1] as f64;
    let wind = &a.wind;
    let tt = quant(c.time, wind.q);
    let mut piece = |source_rect: [f64; 4], destination: [f64; 4]| {
        if let Some(src) = source {
            blit(
                &mut d,
                src,
                source_rect,
                destination,
                "source-over",
                1.0,
                0.0,
            );
        } else {
            image(&mut d, &a.character, Some(source_rect), destination, "low");
        }
    };
    if wind.amp == 0.0 {
        piece([0.0, 0.0, w, h], [g.pad[0], g.pad[1], w, h]);
    } else if wind.axis == Axis::Col {
        for i in 0..72 {
            let s0 = round(i as f64 / 72.0 * w);
            let s1 = round((i + 1) as f64 / 72.0 * w);
            if s1 <= s0 {
                continue;
            }
            let u0 = s0 / w;
            let uc = (s0 + s1) / 2.0 / w;
            let k = clamp(if wind.dir < 0 {
                (wind.from - uc) / wind.from
            } else {
                (uc - wind.from) / (1.0 - wind.from)
            });
            let ph = (if wind.dir < 0 { 1.0 - u0 } else { u0 }) * wind.freq * TAU;
            let dy = if k <= 0.0 {
                0.0
            } else {
                wind.amp * k.powf(1.6) * (ph - tt * wind.speed).sin()
                    + wind.amp * 0.3 * k * (tt * 2.3 + u0 * 5.0).sin()
            };
            piece(
                [s0, 0.0, s1 - s0, h],
                [g.pad[0] + s0, g.pad[1] + dy, s1 - s0, h],
            );
        }
    } else {
        for i in 0..80 {
            let s0 = round(i as f64 / 80.0 * h);
            let s1 = round((i + 1) as f64 / 80.0 * h);
            if s1 <= s0 {
                continue;
            }
            let v0 = s0 / h;
            let k = clamp((v0 - wind.from) / (1.0 - wind.from));
            let dx = wind.amp * k * k * (v0 * wind.freq * TAU - tt * wind.speed).sin()
                + wind.amp * 0.35 * k * (tt * 1.7 + v0 * 3.0).sin();
            piece(
                [0.0, s0, w, s1 - s0],
                [g.pad[0] + dx, g.pad[1] + s0, w, s1 - s0],
            );
        }
    }
    surface(out, id, g.size, d);
}
pub(super) fn prepare(out: &mut Vec<Command>, a: &KanjiSlam, c: &Clock, g: &Character) {
    let w = g.image[0] as f64;
    let h = g.image[1] as f64;
    let rect = [0.0, 0.0, w, h];
    let [dx, dy] = a.rim_off;
    let mut d = Draw::new(1920.0, 1080.0);
    image(&mut d, &a.character, None, rect, "low");
    d.rect(rect, fill(solid(a.rim), "source-in"));
    surface(out, "ks-char-tint", g.image, d);
    let mut d = Draw::new(1920.0, 1080.0);
    all(
        &mut d,
        "ks-char-tint",
        g.image,
        rect,
        "source-over",
        1.0,
        0.0,
    );
    d.commands.push(Command::Image {
        image: a.character.clone(),
        source_rect: None,
        destination_rect: [dx, dy, w, h],
        transform: I,
        operations: vec![],
        clip: None,
        composite: "destination-out",
        opacity: 1.0,
        smoothing: true,
        smoothing_quality: "low",
    });
    surface(out, "ks-char-band", g.image, d);
    let mut d = Draw::new(1920.0, 1080.0);
    all(
        &mut d,
        "ks-char-band",
        g.image,
        rect,
        "source-over",
        1.0,
        1.5,
    );
    d.commands.push(Command::Image {
        image: a.character.clone(),
        source_rect: None,
        destination_rect: rect,
        transform: I,
        operations: vec![],
        clip: None,
        composite: "destination-in",
        opacity: 1.0,
        smoothing: true,
        smoothing_quality: "low",
    });
    surface(out, "ks-char-inner", g.image, d);
    release(out, "ks-char-band");
    let mut d = Draw::new(1920.0, 1080.0);
    all(
        &mut d,
        "ks-char-tint",
        g.image,
        [-dx, -dy * 0.5, w, h],
        "source-over",
        1.0,
        16.0,
    );
    d.commands.push(Command::Image {
        image: a.character.clone(),
        source_rect: None,
        destination_rect: rect,
        transform: I,
        operations: vec![],
        clip: None,
        composite: "destination-out",
        opacity: 1.0,
        smoothing: true,
        smoothing_quality: "low",
    });
    surface(out, "ks-char-halo", g.image, d);
    release(out, "ks-char-tint");
    warp(out, a, c, g, "ks-body", None);
    warp(out, a, c, g, "ks-rim-inner", Some("ks-char-inner"));
    warp(out, a, c, g, "ks-rim-halo", Some("ks-char-halo"));
    release(out, "ks-char-inner");
    release(out, "ks-char-halo");
    for (id, color) in [
        (
            "ks-cast",
            if a.night() {
                rgb(0x02040c)
            } else {
                rgb(0x2a0a1a)
            },
        ),
        ("ks-night", rgb(0x0a1a3a)),
        ("ks-char-fire", rgb(0x5a1008)),
    ] {
        if id == "ks-night" && !a.night() || id == "ks-char-fire" && !a.fire {
            continue;
        }
        let mut d = Draw::new(1920.0, 1080.0);
        let rect = [0.0, 0.0, g.size[0] as f64, g.size[1] as f64];
        all(&mut d, "ks-body", g.size, rect, "source-over", 1.0, 0.0);
        d.rect(rect, fill(solid(color), "source-in"));
        surface(out, id, g.size, d);
    }
}
pub(super) fn draw(d: &mut Draw, a: &KanjiSlam, c: &Clock, s: &State, g: &Character) {
    d.operations = s.camera(1.15);
    g.draw(
        d,
        "ks-rim-halo",
        g.x,
        g.y + g.bob,
        a.halo_a * if a.fire { 1.3 } else { 1.0 },
        "lighter",
    );
    g.draw(d, "ks-body", g.x, g.y + g.bob, 1.0, "source-over");
    if a.night() {
        g.draw(d, "ks-night", g.x, g.y + g.bob, 0.3, "multiply");
    }
    if a.fire {
        g.draw(d, "ks-char-fire", g.x, g.y + g.bob, 0.35, "multiply");
    }
    g.draw(
        d,
        "ks-rim-inner",
        g.x,
        g.y + g.bob,
        a.rim_a * if a.fire { 1.25 } else { 1.0 },
        "lighter",
    );
    if let Some(dir) = a.voice_dir {
        let mx = g.x + (a.face[0] - 0.5) * g.image[0] as f64 * (g.h / g.image[1] as f64);
        let my = g.y - (1.0 - a.face[1]) * g.h + g.bob;
        for j in 0..3 {
            let q = clamp((quant(c.elapsed, 12.0) - j as f64 * 0.08) / 0.5);
            if q <= 0.0 || q >= 1.0 {
                continue;
            }
            d.path(
                vec![arc(
                    mx,
                    my,
                    60.0 + 480.0 * out(q),
                    dir - 0.5,
                    dir + 0.5,
                    false,
                )],
                vec![stroke(
                    solid(rgba(HI, (1.0 - q) * 0.7)),
                    4.0 * (1.0 - q) + 1.2,
                    "butt",
                    "miter",
                )],
            );
        }
    }
    d.operations.clear();
}
pub(super) fn release_all(out: &mut Vec<Command>, a: &KanjiSlam) {
    for id in ["ks-body", "ks-rim-inner", "ks-rim-halo", "ks-cast"] {
        release(out, id);
    }
    if a.night() {
        release(out, "ks-night");
    }
    if a.fire {
        release(out, "ks-char-fire");
    }
}
