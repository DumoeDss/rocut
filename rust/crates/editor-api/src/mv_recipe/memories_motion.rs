#[path = "memories_math.rs"]
mod m;
#[derive(Clone, Copy, Debug)]
pub struct Slot {
    pub x: f64,
    pub y: f64,
    pub rotation: f64,
    pub scale: f64,
    pub from: [f64; 2],
}
fn slot(x: f64, y: f64, r: f64, s: f64, from: [f64; 2]) -> Slot {
    Slot {
        x,
        y,
        rotation: r,
        scale: s,
        from,
    }
}
pub fn slots(n: usize, seed: f64) -> Vec<Slot> {
    match n {
        1 => vec![slot(960.0, 560.0, -0.035, 1.35, [0.0, -1.0])],
        2 => vec![
            slot(700.0, 470.0, -0.09, 1.05, [-1.0, -0.6]),
            slot(1180.0, 610.0, 0.05, 1.2, [0.4, -1.0]),
        ],
        3 => vec![
            slot(600.0, 380.0, -0.12, 1.0, [-1.0, -0.7]),
            slot(1380.0, 400.0, 0.09, 1.0, [1.0, -0.6]),
            slot(960.0, 660.0, 0.035, 1.18, [0.2, -1.0]),
        ],
        4 => vec![
            slot(560.0, 345.0, -0.135, 0.97, [-1.0, -0.75]),
            slot(1458.0, 292.0, 0.088, 0.97, [1.0, -0.8]),
            slot(1425.0, 800.0, -0.062, 0.97, [1.0, 0.7]),
            slot(862.0, 668.0, 0.04, 1.14, [-0.25, -1.0]),
        ],
        _ => {
            let mut out = Vec::new();
            for i in 0..n - 1 {
                let a = i as f64 / (n - 1) as f64 * std::f64::consts::TAU
                    + 0.6
                    + m::rnds(&[i as f64, seed]) * 0.25;
                out.push(slot(
                    960.0 + a.cos() * 560.0,
                    540.0 + a.sin() * 300.0,
                    m::rnds(&[i as f64, seed + 1.0]) * 0.13,
                    0.86,
                    [a.cos(), a.sin()],
                ));
            }
            out.push(slot(960.0, 600.0, 0.035, 1.12, [0.0, -1.0]));
            out
        }
    }
}
#[derive(Clone, Copy, Debug)]
pub struct Pose {
    pub position: [f64; 2],
    pub rotation: f64,
    pub scale: f64,
    pub height: f64,
    pub alpha: f64,
}
pub fn pose(sl: Slot, index: usize, land: f64, t: f64) -> Option<Pose> {
    let a = t - land;
    if a < -0.42 {
        return None;
    }
    let (mut x, mut y, mut r, mut s, mut h, mut alpha) =
        (sl.x, sl.y, sl.rotation, sl.scale, 0.0, 1.0);
    let [fx, fy] = sl.from;
    let sign = if m::rnds(&[index as f64, 9.0]) > 0.0 {
        1.0
    } else {
        -1.0
    };
    if a < 0.0 {
        let k = 1.0 + a / 0.42;
        h = 1.0 - k * k;
        let lat = 1.0 - m::out_cubic(k);
        x += fx * 230.0 * lat;
        y += fy * 170.0 * lat;
        r += sign * 0.32 * lat;
        s *= 1.0 + 0.62 * h;
        alpha = (k * 5.0).clamp(0.0, 1.0);
    } else {
        let sk = 1.0 - (-a * 9.0).exp();
        x -= fx * 14.0 * (1.0 - sk);
        y -= fy * 10.0 * (1.0 - sk);
        s *= 1.0 - 0.022 * (-a * 11.0).exp() * (a * 34.0).cos();
        r += 0.012 * (-a * 8.0).exp() * (a * 26.0).sin() * sign;
    }
    Some(Pose {
        position: [x, y],
        rotation: r,
        scale: s,
        height: h,
        alpha,
    })
}
pub fn local(p: Pose, x: f64, y: f64) -> [f64; 2] {
    let c = p.rotation.cos();
    let s = p.rotation.sin();
    let x = (x - 280.0) * p.scale;
    let y = (y - 215.5) * p.scale;
    [p.position[0] + x * c - y * s, p.position[1] + x * s + y * c]
}
pub struct Burn {
    pub start: f64,
    pub duration: f64,
    pub from: f64,
    pub to: f64,
}
pub fn burn(t: f64, b: &Burn) -> f64 {
    if t <= b.start {
        -1.0
    } else {
        b.from + (b.to - b.from) * ((t - b.start) / b.duration).clamp(0.0, 1.0).powf(1.5)
    }
}
pub fn burn_time(v: f64, b: &Burn) -> f64 {
    if v <= b.from {
        b.start
    } else if v > b.to {
        f64::INFINITY
    } else {
        b.start + b.duration * ((v - b.from) / (b.to - b.from)).powf(1.0 / 1.5)
    }
}
pub struct Timing {
    pub lands: Vec<f64>,
    pub burns: Vec<Burn>,
    pub push: f64,
    pub start: f64,
    pub end: f64,
}
fn beat(beats: &[f64], i: usize, spb: f64) -> f64 {
    beats
        .get(i)
        .copied()
        .unwrap_or_else(|| beats[beats.len() - 1] + (i as f64 - beats.len() as f64 + 1.0) * spb)
}
pub fn timing(
    beats: &[f64],
    spb: f64,
    start: f64,
    end: f64,
    drop: &[u32],
    burns: &[f64],
    push: Option<f64>,
    heroes: &[(bool, f64)],
) -> Timing {
    let i0 = beats.partition_point(|b| *b <= start - 0.08);
    let lands = heroes
        .iter()
        .enumerate()
        .map(|(j, _)| beat(beats, i0 + drop[j.min(drop.len() - 1)] as usize, spb))
        .collect();
    let burns = heroes
        .iter()
        .enumerate()
        .map(|(j, (hero, face))| {
            let b = burns[j.min(burns.len() - 1)];
            let lower = beat(beats, i0 + b.floor() as usize, spb);
            let upper = beat(beats, i0 + b.ceil() as usize, spb);
            let t = m::lerp(lower, upper, b % 1.0);
            Burn {
                start: t,
                duration: if *hero { (end - t).max(0.6) } else { 1.65 },
                from: -0.03,
                to: if *hero { *face } else { 1.06 },
            }
        })
        .collect();
    Timing {
        lands,
        burns,
        push: push.unwrap_or_else(|| beat(beats, i0 + 8, spb)),
        start,
        end,
    }
}
pub struct Camera {
    pub zoom: f64,
    pub rotation: f64,
    pub center: [f64; 2],
}
pub fn camera(
    t: f64,
    timing: &Timing,
    hero_slot: Slot,
    hero_index: usize,
    face: Option<[f64; 2]>,
    end_zoom: f64,
) -> Camera {
    let k1 = m::inv(timing.start, timing.push, t);
    let mut z = m::lerp(1.0, 1.055, m::in_out_sine(k1));
    let mut rot = m::lerp(0.016, 0.006, k1);
    let mut cx = m::lerp(975.0, 945.0, k1);
    let mut cy = m::lerp(548.0, 560.0, k1);
    let f = face.unwrap_or([0.5, 0.42]);
    let hero = pose(
        hero_slot,
        hero_index,
        *timing.lands.last().unwrap(),
        timing.end,
    )
    .map(|p| local(p, f[0] * 560.0, f[1] * 431.0))
    .unwrap_or([960.0, 540.0]);
    if t > timing.push {
        let k = m::inv(timing.push, timing.end, t);
        let e = 0.55 * m::in_out_sine(k) + 0.45 * k * k * k;
        z = m::lerp(z, end_zoom, e);
        rot = m::lerp(rot, -0.028, e);
        cx = m::lerp(cx, hero[0], e);
        cy = m::lerp(cy, hero[1], e);
    }
    for land in &timing.lands {
        let a = t - land;
        if a >= 0.0 && a < 0.6 {
            z *= 1.0 + 0.011 * (-a * 11.0).exp();
        }
    }
    cx += m::fbm1(t * 0.35, 5.0) * 6.0;
    cy += m::fbm1(t * 0.31, 8.0) * 5.0;
    rot += m::fbm1(t * 0.27, 12.0) * 0.002;
    Camera {
        zoom: z,
        rotation: rot,
        center: [cx, cy],
    }
}
