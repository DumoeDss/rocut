use super::{
    art::{ARM, Art, LAMPS, stops},
    canvas::{Canvas, Op, Surface},
    geometry::{self, G, Geometry, P, R, WH},
    math::*,
    model::{Image, Sample, Settings, View},
};
use std::collections::BTreeMap;
pub struct Frame {
    pub surfaces: Vec<Surface>,
    pub operations: Vec<Op>,
    pub frozen: bool,
    pub held_time: f64,
    pub front: f64,
    pub tail: f64,
    pub velocity: f64,
    pub hero_window: Option<usize>,
}
pub fn draw(
    a: &Settings,
    s: &Sample<'_>,
    images: &BTreeMap<String, &Image>,
) -> Result<Frame, String> {
    let img = images[&a.bg];
    let plan = geometry::build(a, s)?;
    let t = s.time();
    let frozen = t >= plan.freeze[0] && t < plan.freeze[1];
    let tl = if frozen { plan.freeze[0] } else { t };
    let xf = plan.front(t);
    let xt = xf - plan.length;
    let on_screen = xf > -200.0 && xt < W + 200.0;
    let presence = sat(((xf + 300.0) / 900.0).min((W + 600.0 - xt) / 900.0));
    let nose = dec((xf - W * 0.5).abs() / 900.0, 1.0)
        * if xf > -400.0 && xf < W + 900.0 {
            1.0
        } else {
            0.0
        };
    let p = in_out_sine(s.progress());
    let from = a.from.unwrap_or(View {
        zoom: 1.1,
        x: -0.05,
        y: -1.0,
        rot: 0.0,
    });
    let to = a.to.unwrap_or(View {
        zoom: 1.155,
        x: 0.08,
        y: -1.0,
        rot: 0.0,
    });
    let down = index(s.beats, tl).map_or(-1, |i| i as i64) - a.downbeat_index0;
    let down_pulse = if down.rem_euclid(4) == 0 {
        pulse(s.beats, tl, 5.0)
    } else {
        0.0
    };
    let zoom = lerp(from.zoom, to.zoom, p) * (1.0 + 0.008 * down_pulse);
    let amp = 2.2 * presence + 4.0 * nose;
    let quant = (tl * 24.0).floor();
    let bump = [rnds(&[quant, 5.0]) * amp, rnds(&[quant, 12.0]) * amp];
    let drift = [fbm(tl * 0.4, 21.0) * 7.0, fbm(tl * 0.33, 23.0) * 5.0];
    let scale = (W / img.width as f64).max(H / img.height as f64) * zoom;
    let dw = img.width as f64 * scale;
    let dh = img.height as f64 * scale;
    let ox =
        W / 2.0 + lerp(from.x, to.x, p) * ((dw - W) / 2.0).max(0.0) - dw / 2.0 + drift[0] + bump[0];
    let oy =
        H / 2.0 + lerp(from.y, to.y, p) * ((dh - H) / 2.0).max(0.0) - dh / 2.0 + drift[1] + bump[1];
    let mx = |x: f64| ox + x * scale;
    let my = |y: f64| oy + y * scale;
    let mut art = Art::new(img);
    let mut c = Canvas::new("train-root");
    c.blit("train-off", None, [ox, oy, dw, dh]);
    let grad = c.linear(
        [0.0, 0.0, 0.0, H],
        &stops(&[
            (0.0, "rgba(4,6,18,0.5)"),
            (0.35, "rgba(4,6,18,0)"),
            (1.0, "rgba(4,6,18,0)"),
        ]),
    );
    c.save();
    c.composite("source-over");
    c.alpha(1.0);
    c.fill_brush(grad);
    c.fill_rect([0.0, 0.0, W, H]);
    c.restore();
    c.glow(mx(840.0), my(585.0), 700.0, 70.0, "#3F6284", 0.3);
    let lv = geometry::lamp_levels(s.beats, a.bpm, a.downbeat_index0, tl);
    let lamps: Vec<_> = LAMPS
        .iter()
        .map(|&(x, y, r, side)| (mx(x), my(y), r * scale, lv[side]))
        .collect();
    for &(x, y, r, e) in &lamps {
        c.glow(x, y, r * 15.0, r * 12.0, "#FF1C10", 0.2 * e);
        if e > 0.02 {
            c.save();
            c.alpha(sat(e * 1.1));
            let g = c.radial(
                [x - r * 0.15, y - r * 0.15, 0.0, x, y, r * 1.02],
                &stops(&[
                    (0.0, "#FFF3E6"),
                    (0.28, "#FF8A70"),
                    (0.7, "#FF2A1E"),
                    (1.0, "#C8140E"),
                ]),
            );
            c.fill_brush(g);
            c.begin();
            c.arc(x, y, r * 1.02, 0.0, TAU);
            c.fill();
            c.restore();
        }
        c.glow(x, y, r * 4.2, r * 4.2, "#FF3A22", 0.85 * e);
    }
    c.glow(
        mx(250.0),
        my(720.0),
        420.0,
        120.0,
        "#FF2414",
        0.16 * lv[0].max(lv[1]),
    );
    c.glow(
        mx(1500.0),
        my(650.0),
        300.0,
        80.0,
        "#FF2414",
        0.14 * lv[0].max(lv[1]),
    );
    for (x, y, w, h, side) in ARM {
        let e = lv[side];
        let x = mx(x);
        let y = my(y);
        c.save();
        c.alpha(sat(e));
        c.fill_color("#FF4A36");
        c.fill_rect([
            x - w * scale / 2.0,
            y - h * scale / 2.0,
            w * scale,
            h * scale,
        ]);
        c.restore();
        c.glow(x, y, 60.0, 26.0, "#FF2A1E", 0.7 * e);
    }
    let hl_y = R + 420.0;
    if xf > -2200.0 && xf < W + 1400.0 {
        let beam = sat((xf + 2200.0) / 2000.0)
            * if xf < W {
                1.0
            } else {
                sat(1.0 - (xf - W) / 1400.0)
            };
        c.save();
        c.composite("lighter");
        let g = c.linear(
            [xf, 0.0, xf + 1600.0, 0.0],
            &[
                (0.0, format!("rgba(255,236,200,{})", 0.34 * beam)),
                (1.0, "rgba(255,236,200,0)".into()),
            ],
        );
        c.fill_brush(g);
        c.begin();
        c.move_to(xf, hl_y - 16.0);
        c.line_to(xf + 1600.0, hl_y - 260.0);
        c.line_to(xf + 1600.0, hl_y + 340.0);
        c.line_to(xf, hl_y + 16.0);
        c.close();
        c.fill();
        c.restore();
        c.glow(
            xf + 500.0,
            hl_y + 200.0,
            900.0,
            220.0,
            "#FFE6C0",
            0.22 * beam,
        );
    }
    if on_screen {
        let sprites: Vec<_> = plan
            .cars
            .iter()
            .map(|car| art.car(car, &plan, images))
            .collect();
        let blur = if frozen {
            0.0
        } else {
            plan.velocity * a.shutter.unwrap_or(0.5) / 30.0
        };
        let taps = if blur > 1.0 { a.taps.unwrap_or(7) } else { 1 };
        let mut acc = Canvas::new("train-acc");
        acc.ops.push(Op::SetTransform {
            matrix: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
        });
        acc.alpha(1.0);
        acc.composite("source-over");
        acc.filter("none");
        acc.ops.push(Op::ClearRect {
            rect: [0.0, 0.0, W, H],
        });
        acc.composite(if taps > 1 { "lighter" } else { "source-over" });
        for k in 0..taps {
            let offset = if taps > 1 {
                blur * (k as f64 / (taps - 1) as f64 - 0.5)
            } else {
                0.0
            };
            acc.alpha(1.0 / taps as f64);
            for (car, id) in plan.cars.iter().zip(&sprites) {
                let x0 = xf - car.u1 - G + offset + bump[0] * 0.6;
                if x0 > W || x0 + P < 0.0 {
                    continue;
                }
                acc.blit(
                    id,
                    None,
                    [x0, R - 40.0 + bump[1] * 0.6, P, H + 20.0 - (R - 40.0)],
                );
            }
        }
        acc.alpha(1.0);
        acc.composite("source-over");
        art.surfaces.push(Surface {
            id: "train-acc".into(),
            size: [1920, 1080],
            operations: acc.ops,
        });
        c.blit("train-acc", None, [0.0, 0.0, W, H]);
        for &(x, _, _, e) in &lamps {
            if e < 0.02 || !plan.occupied(xf, x) {
                continue;
            }
            c.glow(x, R + 2.0, 320.0, 8.0, "#FF3A22", 0.9 * e);
            c.glow(x, R + 2.0, 110.0, 3.0, "#FFC0B0", 0.8 * e);
            c.glow(x, R + 60.0, 380.0, 70.0, "#FF1E10", 0.14 * e);
            c.glow(x + 40.0, R + 150.0, 60.0, 26.0, "#FF5A40", 0.3 * e);
        }
        for e in &plan.windows {
            let x = xf - (e.u0 + e.u1) / 2.0;
            if x < -300.0 || x > W + 300.0 {
                continue;
            }
            c.glow(
                x - 30.0,
                R + 110.0 + WH / 2.0,
                (e.u1 - e.u0) * 0.75 + blur,
                WH * 0.75,
                "#FF9A48",
                0.16,
            );
        }
        c.glow(xf - 26.0, hl_y, 340.0, 140.0, "#FFE2B8", 0.75);
        c.glow(xf - 26.0, hl_y, 60.0, 34.0, "#FFFFFF", 1.2);
        c.glow(xf - 26.0, hl_y, 1400.0, 14.0, "#FFD8A8", 0.55);
        for y in [hl_y - 10.0, hl_y + 22.0] {
            c.glow(xt + 18.0, y, 40.0, 16.0, "#FF2A1E", 0.9);
            c.glow(xt + 18.0, y, 10.0, 6.0, "#FFD0C0", 0.9);
        }
    }
    after(&mut c, &plan, xt);
    if frozen {
        if let Some(index) = plan.best {
            freeze(&mut c, &plan, xf, index, t - plan.freeze[0]);
        }
    }
    c.vignette(0.5, 0.36, "4,6,14");
    Ok(Frame {
        surfaces: art.surfaces,
        operations: c.ops,
        frozen,
        held_time: tl,
        front: xf,
        tail: xt,
        velocity: plan.velocity,
        hero_window: plan.best,
    })
}
fn after(c: &mut Canvas, plan: &Geometry, xt: f64) {
    if xt < -50.0 {
        return;
    }
    let x1 = W.min(xt);
    if x1 <= 0.0 {
        return;
    }
    let decay = plan.velocity * 0.5;
    c.save();
    c.composite("lighter");
    for (y, w, rgb, a) in [
        (R + 122.0, 3.0, [255.0, 240.0, 214.0], 0.5),
        (R + 110.0 + WH * 0.5, 120.0, [255.0, 170.0, 90.0], 0.07),
        (R + 110.0 + WH - 16.0, 2.0, [255.0, 200.0, 140.0], 0.3),
        (R + 110.0 + WH + 32.0, 9.0, [255.0, 70.0, 56.0], 0.55),
        (R + 410.0, 3.0, [255.0, 50.0, 40.0], 0.55),
        (R + 442.0, 3.0, [255.0, 50.0, 40.0], 0.45),
    ] {
        let stops: Vec<_> = (0..=6)
            .map(|i| {
                let k = i as f64 / 6.0;
                let intensity = (-k * 3.0).exp();
                let cyan = 1.0 - intensity;
                let cold = [57.0, 198.0, 224.0];
                let color: Vec<_> = rgb
                    .iter()
                    .zip(cold)
                    .map(|(v, c)| lerp(*v, c, cyan * 0.8).round() as u32)
                    .collect();
                (
                    k,
                    format!(
                        "rgba({},{},{},{})",
                        color[0],
                        color[1],
                        color[2],
                        a * intensity
                    ),
                )
            })
            .collect();
        let g = c.linear([xt, 0.0, xt - decay * 3.0, 0.0], &stops);
        c.fill_brush(g);
        c.fill_rect([0.0, y - w / 2.0, x1, w]);
    }
    c.restore();
}
fn freeze(c: &mut Canvas, plan: &Geometry, xf: f64, index: usize, age: f64) {
    let e = &plan.windows[index];
    let x0 = xf - e.u1;
    let w = e.u1 - e.u0;
    let y0 = R + 110.0;
    c.save();
    c.begin();
    c.rect([0.0, 0.0, W, H]);
    c.round([x0 - 6.0, y0 - 6.0, w + 12.0, WH + 12.0], 18.0);
    c.fill_color("rgba(4,6,14,0.3)");
    c.ops.push(Op::Fill { rule: "evenodd" });
    c.restore();
    c.glow(
        x0 + w / 2.0,
        y0 + WH / 2.0,
        w * 1.1,
        WH * 1.1,
        "#FFB060",
        0.28,
    );
    let k = out_expo(sat(age / 0.09));
    let margin = lerp(70.0, 20.0, k);
    c.save();
    c.stroke_color(&rgba("#FFE3B0", 0.92));
    c.width(3.0);
    c.begin();
    for (sx, sy) in [(false, false), (true, false), (true, true), (false, true)] {
        let x = if sx { x0 + w + margin } else { x0 - margin };
        let y = if sy { y0 + WH + margin } else { y0 - margin };
        let dx = if sx { -1.0 } else { 1.0 };
        let dy = if sy { -1.0 } else { 1.0 };
        c.move_to(x + dx * 34.0, y);
        c.line_to(x, y);
        c.line_to(x, y + dy * 34.0);
    }
    c.stroke();
    c.restore();
}
