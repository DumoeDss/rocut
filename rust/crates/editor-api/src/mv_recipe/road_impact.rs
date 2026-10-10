use super::{
    camera::Camera,
    math::*,
    plan::{Action as A, Draw},
};
fn segment(d: &mut Draw, a: [f64; 3], b: [f64; 3]) {
    d.a(A::BeginPath);
    d.a(A::MoveTo {
        point: [a[0], a[1]],
    });
    d.a(A::LineTo {
        point: [b[0], b[1]],
    });
    d.a(A::Stroke);
}
pub fn impact(d: &mut Draw, c: Camera, time: f64) {
    let Some(pi) = c.p([0.0, 0.0, 4.0]) else {
        return;
    };
    if time < 0.0 {
        return;
    }
    d.a(A::Save);
    d.a(A::Composite { value: "lighter" });
    d.a(A::LineCap { value: "round" });
    for (delay, rmax, amp) in [
        (0.0, 1.7, 0.9),
        (0.1, 1.25, 0.7),
        (0.24, 2.3, 0.5),
        (0.42, 3.1, 0.35),
        (0.7, 4.2, 0.25),
    ] {
        let a = time - delay;
        if a <= 0.0 {
            continue;
        }
        let r = rmax * (1.0 - (-a * 1.35).exp());
        let al = amp * (-a * 0.75).exp();
        if al < 0.01 {
            continue;
        }
        d.a(A::BeginPath);
        let mut first = true;
        for i in 0..=72 {
            let angle = i as f64 / 72.0 * TAU;
            let Some(p) = c.p([angle.sin() * r, 0.0, 4.0 + angle.cos() * r]) else {
                first = true;
                continue;
            };
            d.a(if first {
                A::MoveTo {
                    point: [p[0], p[1]],
                }
            } else {
                A::LineTo {
                    point: [p[0], p[1]],
                }
            });
            first = false;
        }
        d.stroke([214.0, 236.0, 255.0], al, 1.0 + 2.4 * (-a * 1.2).exp());
        d.a(A::Stroke);
        d.stroke([214.0, 236.0, 255.0], al * 0.25, 7.0);
        d.a(A::Stroke);
    }
    for i in 0..18 {
        let angle = i as f64 / 18.0 * TAU + rnds(&[i as f64, 31.0]) * 0.2;
        let vr = 0.45 + 0.55 * rnd(&[i as f64, 32.0]);
        let vy = 1.0 + 0.9 * rnd(&[i as f64, 33.0]);
        let tl = 2.0 * vy / 4.2;
        if time < tl {
            let pos = |a: f64| {
                [
                    angle.sin() * vr * a,
                    vy * a - 0.5 * 4.2 * a * a,
                    4.0 + angle.cos() * vr * a,
                ]
            };
            if let (Some(p), Some(q)) = (c.p(pos(time)), c.p(pos((time - 0.045).max(0.0)))) {
                d.stroke([235.0, 246.0, 255.0], 0.9, 2.6);
                segment(d, q, p);
                d.glow(p[0], p[1], 10.0, [221.0, 243.0, 255.0], 0.5);
            }
        } else {
            let a = time - tl;
            if a > 0.8 {
                continue;
            }
            let lx = angle.sin() * vr * tl;
            let lz = 4.0 + angle.cos() * vr * tl;
            let r = 0.25 * (1.0 - (-a * 3.0).exp());
            let al = 0.5 * (-a * 3.0).exp();
            d.a(A::BeginPath);
            let mut first = true;
            for k in 0..=24 {
                let b = k as f64 / 24.0 * TAU;
                let Some(p) = c.p([lx + b.sin() * r, 0.0, lz + b.cos() * r]) else {
                    continue;
                };
                d.a(if first {
                    A::MoveTo {
                        point: [p[0], p[1]],
                    }
                } else {
                    A::LineTo {
                        point: [p[0], p[1]],
                    }
                });
                first = false;
            }
            d.stroke([214.0, 236.0, 255.0], al, 1.2);
            d.a(A::Stroke);
        }
    }
    if time < 0.62 {
        let hj = 0.38 * (std::f64::consts::PI * clamp(time / 0.62)).sin();
        if let (Some(a), Some(b)) = (c.p([0.0, 0.0, 4.0]), c.p([0.0, hj, 4.0])) {
            d.stroke([235.0, 246.0, 255.0], 0.85, 5.0);
            segment(d, a, b);
        }
    }
    if time > 0.22 && time < 1.05 {
        let a = time - 0.22;
        let y = 0.3 + 0.95 * a - 2.1 * a * a;
        if y > 0.0 {
            if let Some(p) = c.p([0.0, y, 4.0]) {
                d.fill([240.0, 248.0, 255.0], 0.95);
                d.a(A::BeginPath);
                d.a(A::Arc {
                    center: [p[0], p[1]],
                    radius: 3.2,
                    start: 0.0,
                    end: TAU,
                });
                d.a(A::Fill);
                d.glow(p[0], p[1], 16.0, [221.0, 243.0, 255.0], 0.5);
            }
        }
    }
    let k = (-time * 3.4).exp();
    d.glow(
        pi[0],
        pi[1],
        120.0 + 200.0 * k,
        [255.0, 244.0, 228.0],
        0.95 * k + 0.1 * (-time * 0.6).exp(),
    );
    d.a(A::Save);
    d.a(A::Translate {
        offset: [pi[0], pi[1]],
    });
    d.a(A::Scale {
        factors: [1.0, 0.018],
    });
    d.radial(
        [0.0, 0.0, 0.0],
        [0.0, 0.0, 1100.0],
        &[
            (0.0, [210.0, 238.0, 255.0], 0.85 * k),
            (1.0, [210.0, 238.0, 255.0], 0.0),
        ],
    );
    d.rect([-1100.0, -1100.0, 2200.0, 2200.0]);
    d.a(A::Restore);
    d.a(A::Restore);
}
