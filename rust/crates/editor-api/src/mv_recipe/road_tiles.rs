use super::{
    camera::Camera,
    math::*,
    model::Sample,
    plan::{Action as A, Draw},
    timing::{self, Tear},
};
pub fn rail(
    d: &mut Draw,
    c: Camera,
    x: f64,
    z0: f64,
    z1: f64,
    w: f64,
    reveal: &dyn Fn(f64) -> f64,
    amp: f64,
) {
    if z1 <= z0 {
        return;
    }
    let l0 = z0.ln();
    let l1 = z1.ln();
    for pass in 0..2 {
        let ww = if pass == 1 { w } else { w * 6.0 };
        let aa = if pass == 1 { 0.95 } else { 0.12 };
        for i in 0..14 {
            let za = (l0 + (l1 - l0) * i as f64 / 14.0).exp();
            let zb = (l0 + (l1 - l0) * (i + 1) as f64 / 14.0).exp();
            let p = c.quad(x - ww, x + ww, za, zb);
            if !d.poly(&p) {
                continue;
            }
            d.fill(ramp(zk((za + zb) / 2.0)), aa * amp * reveal(za));
            d.a(A::Fill);
        }
    }
}
pub fn tear(
    d: &mut Draw,
    c: Camera,
    t: f64,
    clock: &Sample<'_>,
    tm: &Tear,
    hw: f64,
    zb: f64,
    zf: f64,
) {
    let zn = (c.pos[2] + 0.25).max(0.2);
    let reveal = |z: f64| {
        if z >= zb - 0.01 && z <= zf + 0.01 {
            1.0
        } else {
            0.0
        }
    };
    d.a(A::Save);
    d.a(A::Composite { value: "lighter" });
    d.a(A::LineJoin { value: "round" });
    if hw > 0.01 {
        d.surface("road-glow", [480, 270]);
        d.target = "road-glow";
        d.a(A::Transform {
            matrix: [0.25, 0.0, 0.0, 0.25, 0.0, 0.0],
        });
        d.a(A::Filter { blur_px: 7.0 });
        d.a(A::Composite { value: "lighter" });
        let seg = [zn, 3.0, 6.0, 12.0, 25.0, 60.0, 160.0, 2000.0];
        for i in 0..seg.len() - 1 {
            let za = seg[i].max(zn);
            let zz = seg[i + 1];
            if zz <= za {
                continue;
            }
            if d.poly(&c.quad(-hw * 1.6, hw * 1.6, za, zz)) {
                d.fill(
                    ramp(zk((za + zz) / 2.0)),
                    0.5 * 0.9 * clamp((t - tm.open) / 0.6) * reveal(za),
                );
                d.a(A::Fill);
            }
        }
        d.a(A::Transform {
            matrix: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
        });
        d.a(A::Filter { blur_px: 0.0 });
        d.target = "main";
        d.image("road-glow", None, [0.0, 0.0, 1920.0, 1080.0], false);
        d.release("road-glow");
        let seg: [f64; 7] = [45.0, 70.0, 110.0, 180.0, 320.0, 700.0, 3000.0];
        for i in 0..seg.len() - 1 {
            let za = seg[i].max(zn);
            let zz = seg[i + 1];
            if zz <= za {
                continue;
            }
            if d.poly(&c.quad(-hw, hw, za, zz)) {
                d.fill(ramp(zk((za + zz) / 2.0)), 0.3 * reveal(za));
                d.a(A::Fill);
            }
        }
    }
    if hw > 0.05 {
        let gap = 0.055;
        let cw = 2.0 * hw / 4.0;
        for row in zn.floor() as i32..=52 {
            let za = zn.max(row as f64 + gap / 2.0);
            let zz = (row + 1) as f64 - gap / 2.0;
            if zz <= za {
                continue;
            }
            let zc = (za + zz) / 2.0;
            let far = 1.0 - smooth(30.0, 52.0, zc);
            let rev = reveal(zc);
            if rev <= 0.001 || far <= 0.0 {
                continue;
            }
            let col = ramp(zk(zc));
            let tt = t - zc * 0.011;
            let pulse = if tt > tm.open + 0.6 {
                timing::pulse(tt, clock)
            } else {
                0.0
            };
            for q in 0..4 {
                let ig = tm.open
                    + 0.1
                    + (zc - 4.0).abs() * if zc > 4.0 { 0.021 } else { 0.06 }
                    + rnd(&[row as f64, q as f64, 7.0]) * 0.09;
                if t < ig {
                    continue;
                }
                let ia = t - ig;
                let on = clamp(ia / 0.22);
                let flash = 1.0 + 1.1 * (-ia * 7.0).exp();
                let br = ((0.32 + 0.4 * rnd(&[row as f64, q as f64, 3.0])) * flash + 0.5 * pulse)
                    * on
                    * rev
                    * far;
                if br < 0.01 {
                    continue;
                }
                let x0 = -hw + q as f64 * cw + gap / 2.0;
                let x1 = x0 + cw - gap;
                if !d.poly(&c.quad(x0, x1, za, zz)) {
                    continue;
                }
                d.fill(col, (0.2 * br).min(0.9));
                d.a(A::Fill);
                d.stroke(
                    col,
                    (0.45 * br).min(1.0),
                    (2.2 / (zc / 3.0).max(1.0)).max(0.6),
                );
                d.a(A::Stroke);
            }
        }
        for sx in [-1.0, 1.0] {
            rail(d, c, sx * hw, zn, 3000.0, 0.022, &reveal, 0.9);
        }
    }
    d.a(A::Restore);
}
pub fn run(d: &mut Draw, c: Camera, tf: f64, v: f64, zh: f64, s: &Sample<'_>) {
    let hw = 1.15;
    let gap = 0.055;
    let cw = 2.0 * hw / 4.0;
    d.a(A::Save);
    d.a(A::Composite { value: "lighter" });
    d.surface("road-glow", [480, 270]);
    d.target = "road-glow";
    d.a(A::Transform {
        matrix: [0.25, 0.0, 0.0, 0.25, 0.0, 0.0],
    });
    d.a(A::Filter { blur_px: 8.0 });
    d.a(A::Composite { value: "lighter" });
    let mut z = zh - 60.0;
    while z < zh + 14.0 {
        if d.poly(&c.quad(-hw * 1.7, hw * 1.7, z, z + 6.0)) {
            d.fill(ramp(0.35 + 0.4 * smooth(zh + 10.0, zh - 50.0, z)), 0.45);
            d.a(A::Fill);
        }
        z += 6.0;
    }
    d.a(A::Transform {
        matrix: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
    });
    d.a(A::Filter { blur_px: 0.0 });
    d.target = "main";
    d.image("road-glow", None, [0.0, 0.0, 1920.0, 1080.0], false);
    d.release("road-glow");
    let blur = (v / 30.0 * 1.1).min(0.9);
    for row in (zh - 60.0).floor() as i32..=(zh + 14.0).ceil() as i32 {
        let za = row as f64 + gap / 2.0;
        let zz = (row + 1) as f64 - gap / 2.0;
        let zc = (za + zz) / 2.0;
        let rel = zc - zh;
        let col = ramp(0.3 + 0.45 * smooth(10.0, -50.0, rel));
        let fade = smooth(-60.0, -30.0, rel) * (1.0 - smooth(8.0, 14.0, rel));
        let pulse = timing::pulse(tf + rel * 0.01, s);
        for q in 0..4 {
            let br = (0.34 + 0.4 * rnd(&[row as f64, q as f64, 3.0]) + 0.45 * pulse) * fade;
            if br < 0.01 {
                continue;
            }
            let x0 = -hw + q as f64 * cw + gap / 2.0;
            let x1 = x0 + cw - gap;
            if !d.poly(&c.quad(x0, x1, za, zz + blur)) {
                continue;
            }
            d.fill(col, (0.2 * br / (1.0 + blur)).min(0.85));
            d.a(A::Fill);
            d.stroke(col, (0.42 * br / (1.0 + blur * 0.6)).min(1.0), 1.4);
            d.a(A::Stroke);
        }
    }
    for sx in [-1.0, 0.0, 1.0] {
        rail(
            d,
            c,
            sx * hw,
            zh - 400.0,
            zh + 30.0,
            if sx != 0.0 { 0.02 } else { 0.026 },
            &|_| 1.0,
            if sx != 0.0 { 0.8 } else { 1.0 },
        );
    }
    d.a(A::Restore);
}
