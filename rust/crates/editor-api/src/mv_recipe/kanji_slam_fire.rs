use super::{
    clock::Clock, draw::*, glyph_art::Art, glyphs, math::*, palette::rgb, plan::*, raster::*,
    state::State,
};
const SIZE: [u32; 2] = [480, 270];
fn noise() -> Vec<u8> {
    let lattice = |i: f64, j: f64, p: f64| random(&[i.rem_euclid(p), j.rem_euclid(p), 777.0 + p]);
    let value = |u: f64, v: f64, p: f64| {
        let i = u.floor();
        let j = v.floor();
        let fu = u - i;
        let fv = v - j;
        let su = fu * fu * (3.0 - 2.0 * fu);
        let sv = fv * fv * (3.0 - 2.0 * fv);
        lerp(
            lerp(lattice(i, j, p), lattice(i + 1.0, j, p), su),
            lerp(lattice(i, j + 1.0, p), lattice(i + 1.0, j + 1.0, p), su),
            sv,
        )
    };
    (0..128)
        .flat_map(|y| (0..128).map(move |x| (x as f64, y as f64)))
        .map(|(x, y)| {
            let n = 0.55 * value(x / 16.0, y / 16.0, 8.0)
                + 0.3 * value(x / 8.0, y / 8.0, 16.0)
                + 0.15 * value(x / 4.0, y / 4.0, 32.0);
            (clamp((n - 0.36) * 3.2) * 255.0).floor() as u8
        })
        .collect()
}
pub(super) fn prepare(out: &mut Vec<Command>, c: &Clock, s: &State, arts: &[Art]) {
    let mut d = Draw::new(1920.0, 1080.0);
    d.commands.push(Command::AlphaPixels {
        size: [128, 128],
        alpha: noise(),
        position: [0, 0],
    });
    surface(out, "ks-flame-noise", [128, 128], d);
    let mut d = Draw::new(1920.0, 1080.0);
    d.operations.push(Operation::Scale {
        factors: [0.25, 0.25],
    });
    d.operations.extend(s.camera(1.0));
    for glyph in &s.glyphs {
        let art = arts
            .iter()
            .find(|g| g.ch == glyph.ch)
            .expect("prepared fire glyph");
        let count = d.operations.len();
        glyphs::transform(&mut d, glyph, art, s.glyph_scale);
        all(
            &mut d,
            art.ids[1],
            art.size,
            [
                -(art.size[0] as f64) / 2.0,
                -(art.size[1] as f64) / 2.0,
                art.size[0] as f64,
                art.size[1] as f64,
            ],
            "source-over",
            1.0,
            0.0,
        );
        d.operations.truncate(count);
    }
    d.operations.clear();
    d.rect([0.0, 0.0, 480.0, 270.0], fill(solid([1.0; 4]), "source-in"));
    surface(out, "ks-flame-silhouette", SIZE, d);
    let tq = quant(c.time, 12.0);
    let amt = 0.9 + 0.35 * c.pulse(5.0);
    for (id, color, n, step, erode, alpha) in [
        ("ks-flame-red", 0xd8402a, 16, 3.4, 1.0, 0.6),
        ("ks-flame-orange", 0xff9a3a, 10, 2.5, 1.4, 0.65),
        ("ks-flame-yellow", 0xffe9a8, 4, 1.4, 0.0, 0.7),
    ] {
        let mut d = Draw::new(1920.0, 1080.0);
        for i in 1..=n {
            let i = i as f64;
            all(
                &mut d,
                "ks-flame-silhouette",
                SIZE,
                [
                    (tq * 3.0 + i * 0.7).sin() * i * 0.35,
                    -i * step * amt,
                    480.0,
                    270.0,
                ],
                "lighter",
                alpha * (1.0 - i / (n + 1) as f64),
                0.0,
            );
        }
        if erode != 0.0 {
            let sy = (tq * 55.0 * erode) % (128.0 * 3.0);
            let sx = (tq * 1.3).sin() * 6.0;
            d.operations = vec![
                Operation::Scale {
                    factors: [0.9, 3.0],
                },
                Operation::Translate {
                    offset: [sx, sy / 3.0],
                },
            ];
            pattern(
                &mut d,
                "ks-flame-noise",
                [
                    -sx - 10.0,
                    -sy / 3.0 - 10.0,
                    480.0 / 0.9 + 20.0,
                    270.0 / 3.0 + 140.0,
                ],
                "destination-in",
                1.0,
            );
            d.operations.clear();
        }
        all(
            &mut d,
            "ks-flame-silhouette",
            SIZE,
            [0.0, 1.2, 480.0, 270.0],
            "destination-out",
            1.0,
            0.0,
        );
        d.rect(
            [0.0, 0.0, 480.0, 270.0],
            fill(solid(rgb(color)), "source-in"),
        );
        surface(out, id, SIZE, d);
    }
    release(out, "ks-flame-noise");
    release(out, "ks-flame-silhouette");
}
pub(super) fn draw(d: &mut Draw) {
    for (id, alpha) in [
        ("ks-flame-red", 0.85),
        ("ks-flame-orange", 0.9),
        ("ks-flame-yellow", 0.8),
    ] {
        all(d, id, SIZE, FRAME, "lighter", alpha, 0.0);
    }
}
pub(super) fn release_all(out: &mut Vec<Command>) {
    for id in ["ks-flame-red", "ks-flame-orange", "ks-flame-yellow"] {
        release(out, id);
    }
}
pub(super) fn heat_haze(out: &mut Vec<Command>, c: &Clock) {
    let mut d = Draw::new(1920.0, 1080.0);
    all(
        &mut d,
        "ks-scene",
        [1920, 1080],
        FRAME,
        "source-over",
        1.0,
        0.0,
    );
    let tq = quant(c.time, 15.0);
    let sh = 1080.0 / 120.0;
    for i in 0..120 {
        let i = i as f64;
        let y = round(i * sh);
        let y1 = round((i + 1.0) * sh);
        let k = 0.25 + 0.75 * (1.0 - i / 120.0);
        let dx = 3.0 * k * ((i * 0.22 - tq * 7.0).sin() + 0.45 * (i * 0.53 + tq * 11.0).sin());
        blit(
            &mut d,
            "ks-scene",
            [0.0, y, 1920.0, y1 - y],
            [dx, y, 1920.0, y1 - y],
            "source-over",
            1.0,
            0.0,
        );
    }
    surface(out, "ks-heat", [1920, 1080], d);
}
