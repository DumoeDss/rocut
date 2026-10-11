use super::{
    Photo,
    draw::*,
    motion::{self, Burn, Pose},
    plan::Operation,
};
pub fn dust(d: &mut Draw, p: &Photo, pose: Pose, land: f64, t: f64, win: f64) {
    let a = t - land;
    if a < 0.0 || a > 1.4 {
        return;
    }
    for k in 0..22 {
        let k = k as f64;
        let seed = p.index as f64;
        let side = (super::math::rnd(&[k, seed, 1.0]) * 4.0).trunc() as u32;
        let q = super::math::rnd(&[k, seed, 2.0]);
        let lx = match side {
            0 | 2 => q * 560.0,
            1 => 560.0,
            _ => 0.0,
        };
        let ly = match side {
            0 => 0.0,
            1 | 3 => q * 431.0,
            _ => 431.0,
        };
        let nx = match side {
            1 => 1.0,
            3 => -1.0,
            _ => 0.0,
        };
        let ny = match side {
            0 => -1.0,
            2 => 1.0,
            _ => 0.0,
        };
        let [x0, y0] = motion::local(pose, lx, ly);
        let c = pose.rotation.cos();
        let s = pose.rotation.sin();
        let dx = nx * c - ny * s;
        let dy = nx * s + ny * c;
        let dist = (26.0 + 60.0 * super::math::rnd(&[k, seed, 3.0])) * (1.0 - (-a * 5.0).exp());
        let x = x0 + dx * dist + super::math::fbm1(a * 2.0 + k, 3.0) * 10.0;
        let y = y0 + dy * dist - a * 14.0;
        let al = 0.55 * (-a * 2.6).exp() * (0.35 + 0.65 * win);
        let radius = 1.2 + 2.2 * super::math::rnd(&[k, seed, 4.0]);
        d.path(
            vec![arc([x, y], radius)],
            vec![fill(solid(color(255.0, 226.0, 186.0, al)), "lighter")],
        );
    }
}
pub fn ash(d: &mut Draw, p: &Photo, pose: Pose, b: &Burn, t: f64) {
    for f in &p.field.ash {
        let tb = motion::burn_time(f.field + super::field::CRUST * 0.8, b);
        if !(tb < t) {
            continue;
        }
        let a = t - tb;
        let kf = f.k as f64;
        let life = 1.3 + 1.2 * super::math::rnd(&[kf, 7.0]);
        if a > life {
            continue;
        }
        let [x0, y0] = motion::local(pose, f.uv[0] * 560.0, f.uv[1] * 431.0);
        let k = a / life;
        let x = x0
            + (30.0 + 40.0 * super::math::rnds(&[kf, 8.0])) * a
            + super::math::fbm1(a * 1.5 + kf, 9.0) * 26.0;
        let y = y0 - 28.0 * a - 70.0 * a * a;
        let sc = (2.4 + 5.5 * super::math::rnd(&[kf, 10.0]).powf(1.5)) * (1.0 + 0.8 * k);
        let rot = super::math::rnds(&[kf, 11.0]) * 5.0 * a + kf;
        let al = (1.0 - k).powf(1.2);
        let curl = 0.35 + 0.55 * (a * 3.2 + kf).sin().abs();
        let saved = d.operations.clone();
        d.operations.extend([
            Operation::Translate { offset: [x, y] },
            Operation::Rotate { radians: rot },
            Operation::Scale {
                factors: [sc, sc * curl],
            },
        ]);
        let path = vec![
            mv([-1.0, -0.55]),
            ln([0.2, -1.0]),
            ln([1.0, -0.2]),
            ln([0.55, 0.8]),
            ln([-0.5, 0.95]),
            ln([-1.05, 0.3]),
            close(),
        ];
        let hot = (-a * 3.2).exp();
        let alpha = al * (1.0 - 0.6 * hot);
        let c = if super::math::rnd(&[kf, 12.0]) < 0.5 {
            color(110.0, 101.0, 94.0, 1.0)
        } else {
            color(76.0, 69.0, 65.0, 1.0)
        };
        let mut fpaint = fill(solid(c), "source-over");
        fpaint.opacity = alpha;
        let mut spaint = stroke(color(170.0, 158.0, 146.0, 0.7), 0.22, "source-over", "butt");
        spaint.opacity = alpha;
        d.path(path.clone(), vec![fpaint, spaint]);
        if hot > 0.04 {
            let mut fill = fill(solid(color(255.0, 120.0, 40.0, 1.0)), "lighter");
            fill.opacity = hot * 0.9;
            let mut stroke = stroke(color(255.0, 200.0, 120.0, 1.0), 0.3, "lighter", "butt");
            stroke.opacity = hot * 0.9;
            d.path(path, vec![fill, stroke]);
        }
        d.operations = saved;
    }
    for f in &p.field.sparks {
        let k = f.k as f64;
        if super::math::rnd(&[k, 19.0]) > 0.6 {
            continue;
        }
        let tb = motion::burn_time(f.field, b);
        if !(tb < t) {
            continue;
        }
        let a = t - tb;
        let life = 0.3 + 0.55 * super::math::rnd(&[k, 20.0]);
        if a > life {
            continue;
        }
        let [x0, y0] = motion::local(pose, f.uv[0] * 560.0, f.uv[1] * 431.0);
        let vx = super::math::rnds(&[k, 21.0]) * 70.0;
        let vy = -40.0 - 120.0 * super::math::rnd(&[k, 22.0]);
        let pos = |a: f64| {
            [
                x0 + vx * a + (a * 9.0 + k).sin() * 6.0,
                y0 + vy * a - 50.0 * a * a,
            ]
        };
        let xy = pos(a);
        let previous = pos((a - 0.05).max(0.0));
        let al = 1.0 - a / life;
        d.path(
            vec![mv(previous), ln(xy)],
            vec![stroke(
                color(
                    255.0,
                    (150.0 + 90.0 * al).trunc(),
                    (60.0 + 110.0 * al * al).trunc(),
                    0.8 * al,
                ),
                1.3,
                "lighter",
                "round",
            )],
        );
        d.path(
            vec![arc(xy, 1.5)],
            vec![fill(solid(color(255.0, 236.0, 190.0, al)), "lighter")],
        );
    }
}
