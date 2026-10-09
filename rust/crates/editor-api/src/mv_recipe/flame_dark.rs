use super::{
    clock::Clock,
    draw::*,
    math::*,
    model::Flame,
    particles::{self, Embers},
    plan::*,
    raster::*,
};
use crate::mv_image_dimensions::Context;
pub(super) struct Dark {
    pub size: [u32; 2],
    pub hb: f64,
    pub intensity: f64,
    pub scale: f64,
    pub ix: f64,
    pub iy: f64,
    pub light: [f64; 2],
    pub radius: f64,
}
impl Dark {
    pub fn new(a: &Flame, c: &Clock, images: &Context) -> Result<Self, String> {
        let img = images.image(a.image())?;
        let hb = c.pulse(c.t, 9.0) + 0.55 * c.pulse(c.t - 0.16, 12.0);
        let mut intensity = smooth(c.ignite - 0.05, c.ignite + 0.05, c.t)
            * (1.0 + 0.6 * (-(c.t - c.ignite).max(0.0) * 5.0).exp());
        intensity *= (0.64 + 0.36 * hb.min(1.2)) * (1.0 + 0.05 * noise(c.t * 20.0, 4.0));
        for [a0, a1] in a.stops.as_ref().into_iter().flatten() {
            intensity *=
                1.0 - smooth(a0 - 0.02, a0 + 0.05, c.t) * (1.0 - smooth(a1 - 0.02, a1 + 0.1, c.t));
        }
        let scale = a.h / img.height as f64 * (1.0 + 0.045 * sine(c.p)) * (1.0 + 0.006 * hb);
        let ix = a.face_pos[0] - a.face_at[0] * scale;
        let iy = a.face_pos[1] - a.face_at[1] * scale + 18.0 * (1.0 - out_cubic(c.p));
        if ![hb, intensity, scale, ix, iy].iter().all(|v| v.is_finite()) {
            return Err("flame dark produces nonfinite lighting or image transform".into());
        }
        Ok(Self {
            size: [img.width, img.height],
            hb,
            intensity,
            scale,
            ix,
            iy,
            light: [a.face_pos[0] + 50.0, 1250.0],
            radius: 720.0 + 560.0 * intensity,
        })
    }
    pub fn active(&self) -> bool {
        self.intensity > 0.002
    }
}

fn warp(
    d: &mut Draw,
    id: &'static str,
    f: &Dark,
    tq: f64,
    composite: &'static str,
    alpha: f64,
    blur: f64,
) {
    let w = f.size[0] as f64;
    let h = f.size[1] as f64;
    let split = round(w * 0.5);
    d.operations = vec![
        Operation::Translate {
            offset: [f.ix, f.iy],
        },
        Operation::Scale {
            factors: [f.scale, f.scale],
        },
    ];
    blit(
        d,
        id,
        [0.0, 0.0, split, h],
        [0.0, 0.0, split, h],
        composite,
        alpha,
        blur,
    );
    for i in 0..36 {
        let left = split + round((w - split) * i as f64 / 36.0);
        let right = split + round((w - split) * (i + 1) as f64 / 36.0);
        let u = ((left + right) / 2.0 - split) / (w - split);
        let k = u.powf(1.5);
        let dy =
            9.0 * k * (TAU * 1.1 * u - tq * 3.2).sin() + 9.0 * 0.3 * k * (tq * 1.9 + u * 3.0).sin();
        // Width +1 preserves rounded boundary overlap, including the final edge.
        // Blur is on EACH original drawImage, never on a combined warped buffer.
        blit(
            d,
            id,
            [left, 0.0, right - left + 1.0, h],
            [left, dy, right - left + 1.0, h],
            composite,
            alpha,
            blur,
        );
    }
    d.operations.clear();
}

pub(super) fn prepare(out: &mut Vec<Command>, a: &Flame, c: &Clock, f: &Dark) {
    if !f.active() {
        return;
    }
    let w = f.size[0] as f64;
    let h = f.size[1] as f64;
    let mut raw = Draw::new(1920.0, 1080.0);
    image(&mut raw, a.image(), None, [0.0, 0.0, w, h], "low");
    surface(out, "fl-face", f.size, raw);
    let mut mask = Draw::new(1920.0, 1080.0);
    warp(&mut mask, "fl-face", f, c.tq, "source-over", 1.0, 0.0);
    surface(out, "fl-lit-mask", [1920, 1080], mask);
    let mut lit = Draw::new(1920.0, 1080.0);
    all(
        &mut lit,
        "fl-lit-mask",
        [1920, 1080],
        FRAME,
        "source-over",
        1.0,
        0.0,
    );
    let [x, y] = f.light;
    let r = f.radius;
    let cover = [-2400.0, -2400.0, 6720.0, 5880.0];
    lit.rect(
        cover,
        fill(
            Style::Radial {
                from: [x, y, r * 0.2],
                to: [x, y, r],
                stops: stops(&[
                    (0.0, rgb(6, 3, 6, 0.0)),
                    (0.45, rgb(6, 3, 6, 0.42)),
                    (0.8, rgb(6, 3, 6, 0.88)),
                    (1.0, rgb(5, 2, 5, 0.97)),
                ]),
            },
            "source-atop",
        ),
    );
    let level = clamp(1.0 - f.intensity) * 0.9;
    if level > 0.0 {
        lit.rect(cover, fill(solid(rgb(4, 2, 4, level)), "source-atop"));
    }
    lit.rect(
        cover,
        fill(
            radial(
                x,
                y,
                r * 1.1,
                &[
                    (0.0, rgb(255, 214, 168, 1.0)),
                    (0.5, rgb(255, 154, 94, 1.0)),
                    (1.0, rgb(106, 76, 122, 1.0)),
                ],
            ),
            "multiply",
        ),
    );
    all(
        &mut lit,
        "fl-lit-mask",
        [1920, 1080],
        FRAME,
        "destination-in",
        1.0,
        0.0,
    );
    surface(out, "fl-lit", [1920, 1080], lit);
    release(out, "fl-lit-mask");
    let mut tinted = Draw::new(1920.0, 1080.0);
    all(
        &mut tinted,
        "fl-face",
        f.size,
        [0.0, 0.0, w, h],
        "source-over",
        1.0,
        0.0,
    );
    tinted.rect(
        [0.0, 0.0, w, h],
        fill(solid(rgb(255, 160, 96, 1.0)), "source-in"),
    );
    surface(out, "fl-tint", f.size, tinted);
    let mut rim = Draw::new(1920.0, 1080.0);
    all(
        &mut rim,
        "fl-tint",
        f.size,
        [0.0, 0.0, w, h],
        "source-over",
        1.0,
        0.0,
    );
    all(
        &mut rim,
        "fl-face",
        f.size,
        [0.0, -8.0, w, h],
        "destination-out",
        1.0,
        0.0,
    );
    surface(out, "fl-rim", f.size, rim);
    release(out, "fl-tint");
    release(out, "fl-face");
}
pub(super) fn draw(d: &mut Draw, c: &Clock, f: &Dark) {
    d.background(rgb(3, 2, 4, 1.0));
    if !f.active() {
        return;
    }
    let [x, _] = f.light;
    let i = f.intensity;
    glow(
        d,
        x,
        1140.0,
        1000.0 * (0.6 + 0.4 * i),
        rgb(74, 20, 20, 1.0),
        0.55 * i,
    );
    all(d, "fl-lit", [1920, 1080], FRAME, "source-over", 1.0, 0.0);
    warp(d, "fl-rim", f, c.tq, "source-over", 0.6 * clamp(i), 0.0);
    warp(d, "fl-rim", f, c.tq, "lighter", 0.4 * clamp(i), 4.0);
    glow(d, x, 1150.0, 460.0, rgb(255, 106, 42, 1.0), 0.34 * i);
    glow(d, x, 1120.0, 170.0, rgb(255, 216, 160, 1.0), 0.3 * i);
    particles::embers(
        d,
        c.t,
        Embers {
            n: 18,
            x,
            y: 1110.0,
            spread: 320.0,
            rise: 110.0,
            life: [2.6, 4.2],
            size: 2.2,
            alpha: 0.75 * clamp(i),
            seed: 31.0,
            drift: 90.0,
        },
    );
    particles::vignette(
        d,
        0.8 - 0.18 * f.hb.min(1.0) * clamp(i),
        0.28,
        rgb(3, 1, 3, 1.0),
    );
}
