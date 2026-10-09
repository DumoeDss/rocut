use super::{clock::Clock, draw::*, math::*, model::Palette, plan::*};

pub(super) fn ember(d: &mut Draw, c: &Clock, p: &Palette) -> f64 {
    let core_r = 16.0 + 80.0 * c.u * c.u + 26.0 * c.pulse;
    let intensity = 0.8 + 1.8 * c.u + 0.6 * c.pulse;
    let k = (intensity * (1.0 + 0.07 * noise(c.t * 17.0, 3.0) + 0.05 * noise(c.t * 43.0, 5.0)))
        .max(0.0);
    if k > 0.002 {
        let r1 = 40.0 + 300.0 * k;
        d.glow(
            960.0,
            540.0,
            r1,
            &[
                (0.0, rgba(p.sunset, 0.42 * k)),
                (0.1, rgba(p.verm, 0.26 * k.min(1.2))),
                (0.38, rgba(p.dusk, 0.08 * k.min(1.2))),
                (1.0, rgba(p.dusk, 0.0)),
            ],
            "lighter",
        );
        let r2 = 7.0 + 30.0 * k;
        d.glow(
            960.0,
            540.0,
            r2,
            &[
                (0.0, rgba(p.hi, 0.85 * k + 0.15)),
                (0.3, rgba(p.glow, 0.6 * k.min(1.0))),
                (1.0, rgba(p.sunset, 0.0)),
            ],
            "lighter",
        );
        let length = 360.0 + 1500.0 * c.u * c.u;
        for (hh, alpha) in [(2.2, 0.55), (9.0, 0.12)] {
            let style = radial(
                0.0,
                0.0,
                hh,
                &[
                    (0.0, rgba(p.hi, alpha * k.min(1.0))),
                    (0.35, rgba(p.glow, alpha * 0.4 * k.min(1.0))),
                    (1.0, rgba(p.sunset, 0.0)),
                ],
            );
            d.commands.push(Command::Rect {
                transform: d.identity(),
                operations: vec![
                    Operation::Translate {
                        offset: [960.0, 540.0],
                    },
                    Operation::Scale {
                        factors: [length / hh, 1.0],
                    },
                ],
                rect: [-hh, -hh, 2.0 * hh, 2.0 * hh],
                paint: fill(style, "lighter"),
            });
        }
        d.path(
            circle(960.0, 540.0, 1.1 + 2.4 * k.min(1.5)),
            vec![fill(solid(rgba(p.core, 0.6 + k)), "lighter")],
        );
    }
    let amount = 0.55 + 0.4 * c.u;
    d.glow(
        960.0,
        540.0,
        core_r * 3.2,
        &[
            (0.0, rgba(p.hi, amount)),
            (0.25, rgba(p.hi, amount * 0.45)),
            (1.0, rgba(p.hi, 0.0)),
        ],
        "lighter",
    );
    core_r
}
pub(super) fn white(d: &mut Draw, c: &Clock, p: &Palette, core_r: f64) {
    let k = seg(c.t, c.white - 0.34, 0.34);
    let wk = if k <= 0.0 {
        0.0
    } else {
        2.0f64.powf(10.0 * k - 10.0)
    };
    if wk > 0.0 {
        d.path(
            circle(960.0, 540.0, lerp(core_r, 1200.0, wk)),
            vec![fill(solid(rgba(p.white, 0.4 + wk)), "source-over")],
        );
        let fade = seg(c.t, c.white - 0.12, 0.12);
        d.screen(p.white, fade * fade);
    }
    if c.t >= c.white {
        d.screen(p.white, 1.0);
    }
}
