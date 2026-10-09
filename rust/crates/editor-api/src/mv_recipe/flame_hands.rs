use super::{
    clock::Clock,
    draw::*,
    fire,
    math::*,
    model::{Flame, Mode},
    particles::{self, Embers},
    plan::*,
    raster::*,
};
use crate::{
    mv_image_dimensions::Context,
    mv_image_preprocess::{ALGORITHM, Binding, Request},
    programmatic_resources::Resource,
};

pub(super) struct Hands {
    pub image: [u32; 2],
    pub fa: [f64; 6],
    pub s: f64,
    pub fx: f64,
    pub fy: f64,
    pub intensity: f64,
    pub flood: f64,
    pub white: f64,
    pub spark: f64,
    pub embers: u32,
    pub light: f64,
}
impl Hands {
    pub fn new(a: &Flame, c: &Clock, images: &Context) -> Result<Self, String> {
        let img = images.image(a.image())?;
        let fa = a.landmarks(img.width, img.height);
        let (s, fx, fy, mut intensity, flood, white, mut spark, embers);
        if a.mode == Mode::Grow {
            let beats = c.steps(c.start, c.end - 0.02, 0.001)?.max(1.0);
            let g = 0.5 * sine(c.p) + 0.5 * c.steps(c.start, c.t, 0.25)? / beats;
            intensity = 0.55 + g + 0.08 * c.pulse(c.t, 7.0) + 0.1 * c.down(c.t, 5.0);
            let k = cubic(c.p);
            s = lerp(1.24, 1.0, k);
            fx = 960.0;
            fy = lerp(560.0, 608.0, k);
            flood = smooth(0.05, 0.95, g);
            white = 0.0;
            spark = -1.0;
            embers = round(10.0 + 60.0 * g) as u32;
        } else {
            let push = sine(inv(c.start, c.zoom, c.t));
            let zk = inv(c.zoom, c.end, c.t);
            s = lerp(0.98, 1.1, push) * (a.zoom_to.ln() * zk.powi(3)).exp();
            fx = 960.0;
            fy = lerp(lerp(590.0, 612.0, push), 540.0, sine(zk));
            intensity = 0.82
                + 0.08 * (TAU * (c.t - c.start) / (4.0 * c.spb)).sin()
                + 0.1 * c.pulse(c.t, 6.0)
                + 0.1 * c.vocal;
            intensity *= smooth(c.start - 0.1, c.start + 0.3, c.t);
            let mut last_end = c.start;
            spark = -1.0;
            for [a0, a1] in &c.stops {
                let gut =
                    smooth(a0 - 0.01, a0 + 0.07, c.t) * (1.0 - smooth(a1 - 0.03, a1 + 0.04, c.t));
                intensity = lerp(
                    intensity,
                    0.03 + 0.035 * (0.5 + 0.5 * noise(c.t * 22.0, 5.0)),
                    gut,
                );
                if c.t >= a1 - 0.03 {
                    intensity *= 1.0
                        + 0.6
                            * (-(c.t - a1).max(0.0) * 5.0).exp()
                            * smooth(a1 - 0.03, a1 + 0.05, c.t);
                }
                if c.t >= *a1 {
                    spark = c.t - a1;
                }
                last_end = last_end.max(*a1);
            }
            if last_end == c.zoom {
                return Err("flame breathe stop end makes growth interval degenerate".into());
            }
            intensity *= 1.0 + 0.25 * sine(inv(last_end, c.zoom, c.t)) + 1.6 * zk.powi(2);
            white = inv(c.zoom + 0.1, c.end, c.t).powi(3);
            flood = 0.0;
            embers = round(6.0 + 14.0 * clamp(intensity - 0.5)) as u32;
        }
        let light = intensity.max(0.0) * (1.0 + 0.035 * noise(c.t * 24.0, 17.0));
        if ![s, fx, fy, intensity, flood, white, spark, light]
            .iter()
            .all(|v| v.is_finite())
            || intensity < 0.0
            || embers > 100
        {
            return Err("flame produces nonfinite or unbounded lighting/particles".into());
        }
        Ok(Self {
            image: [img.width, img.height],
            fa,
            s,
            fx,
            fy,
            intensity,
            flood,
            white,
            spark,
            embers,
            light,
        })
    }
    pub fn by(&self) -> f64 {
        self.fy + (self.fa[2] - self.fa[1]) * self.s
    }
    pub fn radius(&self) -> f64 {
        self.s * (170.0 + 1100.0 * self.light.min(1.6).powf(0.9)) * (1.0 + 0.5 * self.flood)
    }
}

pub(super) fn prepare(
    out: &mut Vec<Command>,
    a: &Flame,
    h: &Hands,
    resources: &[Resource],
) -> Result<(), String> {
    let resource = resources
        .iter()
        .find(|r| r.id == a.image() && r.kind == "image")
        .ok_or("flame hand image declaration missing")?
        .clone();
    let request = Request::new(Binding {
        resource,
        width: h.image[0],
        height: h.image[1],
        flame_at: h.fa,
        algorithm: ALGORITHM.into(),
    })?;
    let key = request.patch_key()?;
    // Image-space commands intentionally use identity, not the target/output CTM.
    let mut base = Draw::new(1920.0, 1080.0);
    image(
        &mut base,
        a.image(),
        None,
        [0.0, 0.0, h.image[0] as f64, h.image[1] as f64],
        "low",
    );
    base.commands.push(Command::PreparedPatch {
        request,
        patch_key: key,
    });
    let w = h.image[0] as f64;
    let ht = h.image[1] as f64;
    let feather = round(w * 0.09);
    for (from, to, rect) in [
        (
            [16.0, 0.0],
            [16.0 + feather, 0.0],
            [0.0, 0.0, 16.0 + feather, ht],
        ),
        (
            [w - 16.0, 0.0],
            [w - 16.0 - feather, 0.0],
            [w - 16.0 - feather, 0.0, 16.0 + feather, ht],
        ),
        (
            [0.0, 16.0],
            [0.0, 16.0 + feather * 0.8],
            [0.0, 0.0, w, 16.0 + feather * 0.8],
        ),
    ] {
        base.rect(
            rect,
            fill(
                linear(
                    from,
                    to,
                    &[(0.0, rgb(0, 0, 0, 1.0)), (1.0, rgb(0, 0, 0, 0.0))],
                ),
                "destination-out",
            ),
        );
    }
    surface(out, "fl-base", h.image, base);
    let mut mask = Draw::new(1920.0, 1080.0);
    all(
        &mut mask,
        "fl-base",
        h.image,
        [
            h.fx - h.fa[0] * h.s,
            h.fy - h.fa[1] * h.s,
            w * h.s,
            ht * h.s,
        ],
        "source-over",
        1.0,
        0.0,
    );
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
    let r = h.radius();
    let dark = lerp(0.95, 0.5, h.flood);
    let level = clamp(0.62 - h.light) * 0.95;
    let gradient = Style::Radial {
        from: [h.fx, h.fy, r * 0.05],
        to: [h.fx, h.fy, r],
        stops: stops(&[
            (0.0, rgb(8, 3, 8, 0.0)),
            (0.3, rgb(8, 3, 8, dark * 0.3)),
            (0.7, rgb(8, 3, 8, dark * 0.82)),
            (1.0, rgb(6, 2, 6, dark)),
        ]),
    };
    lit.rect(
        [-2400.0, -2400.0, 6720.0, 5880.0],
        fill(gradient, "source-atop"),
    );
    if level > 0.0 {
        lit.rect(
            [-2400.0, -2400.0, 6720.0, 5880.0],
            fill(solid(rgb(6, 2, 6, level)), "source-atop"),
        );
    }
    surface(out, "fl-lit", [1920, 1080], lit);
    release(out, "fl-lit-mask");
    release(out, "fl-base");
    // Read FROM the fully lit sprite. Masking an unlit image changes fingertip light.
    let mut fingers = Draw::new(1920.0, 1080.0);
    all(
        &mut fingers,
        "fl-lit",
        [1920, 1080],
        FRAME,
        "source-over",
        1.0,
        0.0,
    );
    let r = 230.0 * h.s;
    let cy = h.by() - 222.0 * h.s;
    fingers.rect(
        [
            h.fx - 170.0 * h.s,
            h.by() - 60.0 * h.s,
            340.0 * h.s,
            260.0 * h.s,
        ],
        fill(
            Style::Radial {
                from: [h.fx, cy, r - 14.0 * h.s],
                to: [h.fx, cy, r + 12.0 * h.s],
                stops: stops(&[(0.0, rgb(0, 0, 0, 0.0)), (1.0, rgb(0, 0, 0, 1.0))]),
            },
            "destination-in",
        ),
    );
    surface(out, "fl-fingers", [1920, 1080], fingers);
    Ok(())
}

pub(super) fn draw(d: &mut Draw, a: &Flame, c: &Clock, h: &Hands) {
    let bx = h.fx;
    let by = h.by();
    d.background(rgb(4, 2, 5, 1.0));
    if h.flood > 0.0 {
        d.rect(
            FRAME,
            fill(
                radial(
                    bx,
                    by - 60.0 * h.s,
                    1500.0,
                    &[
                        (0.0, rgb(240, 102, 58, 0.85 * h.flood)),
                        (0.25, rgb(200, 55, 58, 0.65 * h.flood)),
                        (0.55, rgb(122, 35, 80, 0.5 * h.flood)),
                        (1.0, rgb(58, 23, 69, 0.4 * h.flood)),
                    ],
                ),
                "source-over",
            ),
        );
        particles::rays(d, bx, by - 80.0 * h.s, 0.07 * h.flood, c.t);
    }
    all(d, "fl-lit", [1920, 1080], FRAME, "source-over", 1.0, 0.0);
    glow(
        d,
        h.fx,
        h.fy - 20.0 * h.s,
        h.radius() * 0.45,
        rgb(255, 106, 42, 1.0),
        0.05 * h.light.min(1.6),
    );
    let height = fire::draw(
        d,
        bx,
        by,
        250.0 * h.s,
        h.intensity,
        c.tq,
        if a.mode == Mode::Grow { 0.8 } else { 1.0 },
    );
    all(
        d,
        "fl-fingers",
        [1920, 1080],
        FRAME,
        "source-over",
        1.0,
        0.0,
    );
    if height > 0.0 {
        glow(
            d,
            bx,
            by - height * 0.25,
            height * 0.9,
            rgb(255, 138, 58, 1.0),
            0.12 * h.light.min(1.6),
        );
    }
    if h.spark >= 0.0 && h.spark < 1.3 {
        fire::sparks(d, bx, by - height * 0.45, h.spark, h.s);
    }
    particles::embers(
        d,
        c.t,
        Embers {
            n: h.embers,
            x: bx,
            y: by - height * 0.7,
            spread: 45.0 * h.s,
            rise: 150.0 * h.s,
            life: [1.1, 2.4],
            size: 2.3 * h.s,
            alpha: (0.4 + 0.6 * h.intensity).clamp(0.0, 1.0),
            seed: 17.0,
            drift: 70.0,
        },
    );
    if h.flood > 0.0 {
        particles::embers(
            d,
            c.t,
            Embers {
                n: round(50.0 * h.flood) as u32,
                x: 960.0,
                y: 1110.0,
                spread: 1000.0,
                rise: 170.0,
                life: [2.2, 4.2],
                size: 2.8,
                alpha: 0.8 * h.flood,
                seed: 23.0,
                drift: 120.0,
            },
        );
    }
    particles::vignette(d, lerp(0.75, 0.5, h.flood), 0.3, rgb(4, 1, 4, 1.0));
    if h.white > 0.0 {
        d.background(rgb(255, 246, 232, h.white));
    }
}
