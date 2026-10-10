//! Original gatherPlan and quadratic comet path; independently CPU-testable.
#[path = "converge_math.rs"]
mod seeded;
#[path = "heart_clock.rs"]
mod timing;
pub struct Candidate {
    pub index: usize,
    pub coverage: f64,
}
#[derive(Debug)]
pub struct Arrival {
    pub shard: usize,
    pub k: usize,
    pub at: f64,
    pub duration: f64,
    pub angle: f64,
    pub radius: f64,
    pub far: bool,
    pub side: f64,
    pub bend: f64,
    pub size: f64,
    pub spin: f64,
    pub flip: f64,
    pub flip_velocity: f64,
    pub to_hand: bool,
    pub random: f64,
}
fn range(r: &mut seeded::Rng, a: f64, b: f64) -> f64 {
    a + (b - a) * r.next()
}
pub fn plan(
    candidates: &[Candidate],
    count: usize,
    beats: &[f64],
    spb: f64,
    t0: f64,
    t1: f64,
) -> Result<Vec<Arrival>, &'static str> {
    if count == 0
        || count > 224
        || beats.is_empty()
        || ![spb, t0, t1].iter().all(|v| v.is_finite())
        || spb <= 0.0
        || t1 <= t0
        || beats.iter().any(|v| !v.is_finite())
        || !beats.windows(2).all(|v| v[0] < v[1])
        || candidates
            .iter()
            .any(|c| !c.coverage.is_finite() || c.coverage < 0.0)
    {
        return Err("Invalid Heart gather clock or shard count");
    }
    let mut list: Vec<_> = candidates.iter().collect();
    list.sort_by(|a, b| b.coverage.total_cmp(&a.coverage));
    list.truncate(count);
    if list.is_empty() {
        return Err("Heart gather requires retained shards");
    }
    let mut arrivals = Vec::new();
    let mut i = timing::beat_index(beats, t0 + 0.3);
    loop {
        let at = timing::beat_time(beats, i, spb).ok_or("Missing Heart gather beat")?;
        if at >= t1 - 0.03 {
            break;
        }
        arrivals.push(at);
        // Only the first list.len() beats affect the original plan.
        if arrivals.len() == list.len() {
            break;
        }
        i = i.checked_add(1).ok_or("Heart gather beat overflow")?;
    }
    let nb = arrivals.len().min(list.len());
    let rest = list.len() - nb;
    Ok(list
        .into_iter()
        .enumerate()
        .map(|(k, c)| {
            let mut r = seeded::Rng::new(seeded::hash(&[k as f64, 4411.0]) as f64);
            let at = if k < nb {
                arrivals[k]
            } else {
                seeded::lerp(
                    t0 + 0.28,
                    t1 - 0.06,
                    (k as f64 - nb as f64 + 0.15 + 0.7 * r.next()) / rest.max(1) as f64,
                )
            };
            let far = r.next() < 0.35;
            Arrival {
                shard: c.index,
                k,
                at,
                duration: 0.85 + 0.55 * r.next(),
                angle: k as f64 * 2.39996 + range(&mut r, -0.3, 0.3),
                radius: if far {
                    780.0 + 260.0 * r.next()
                } else {
                    330.0 + 330.0 * r.next()
                },
                far,
                side: if r.next() < 0.5 { -1.0 } else { 1.0 },
                bend: range(&mut r, 0.22, 0.5),
                size: range(&mut r, 0.9, 1.25),
                spin: range(&mut r, -2.5, 2.5),
                flip: r.next() * std::f64::consts::TAU,
                flip_velocity: range(&mut r, -3.0, 3.0),
                to_hand: k % 5 == 3,
                random: r.next(),
            }
        })
        .collect())
}
pub fn in_out_cubic(x: f64) -> f64 {
    if x < 0.5 {
        4.0 * x * x * x
    } else {
        1.0 - (-2.0 * x + 2.0).powi(3) / 2.0
    }
}
pub fn smooth(a: f64, b: f64, x: f64) -> f64 {
    let k = ((x - a) / (b - a)).clamp(0.0, 1.0);
    k * k * (3.0 - 2.0 * k)
}
pub struct Flight {
    pub target: [f64; 2],
    pub position: [f64; 2],
    pub progress: f64,
    pub eased: f64,
    pub scale: f64,
    pub spin: f64,
    pub flip: f64,
    pub glint: f64,
    pub glass: f64,
    pub firefly: f64,
    pub trail: Vec<[f64; 2]>,
}
fn bez(p0: [f64; 2], p1: [f64; 2], cp: [f64; 2], u: f64) -> [f64; 2] {
    let m = 1.0 - u;
    [
        m * m * p0[0] + 2.0 * m * u * cp[0] + u * u * p1[0],
        m * m * p0[1] + 2.0 * m * u * cp[1] + u * u * p1[1],
    ]
}
pub fn flight(
    q: &Arrival,
    t: f64,
    chest: [f64; 2],
    hand: [f64; 2],
    glow_phase: f64,
    ff: bool,
) -> Flight {
    let p1 = if q.to_hand { hand } else { chest };
    let p0 = if q.far {
        [
            chest[0] + q.angle.cos() * q.radius * 1.5,
            chest[1] + q.angle.sin() * q.radius * 0.8,
        ]
    } else {
        [
            (chest[0] + q.angle.cos() * q.radius * 1.45).clamp(90.0, 1830.0),
            (chest[1] + q.angle.sin() * q.radius * 0.85).clamp(70.0, 850.0),
        ]
    };
    let mx = (p0[0] + p1[0]) / 2.0;
    let my = (p0[1] + p1[1]) / 2.0;
    let len = (p1[0] - p0[0]).hypot(p1[1] - p0[1]).max(1.0);
    let cp = [
        mx - ((p1[1] - p0[1]) / len) * len * q.bend * q.side,
        my + ((p1[0] - p0[0]) / len) * len * q.bend * q.side,
    ];
    let raw = ((t - (q.at - q.duration)) / q.duration).clamp(0.0, 1.0);
    let u = in_out_cubic(raw);
    let hov = 1.0 - u;
    let hx = hov * 10.0 * (t * 1.1 + q.k as f64).sin();
    let hy = hov * 12.0 * (t * 0.9 + q.k as f64 * 1.3).cos();
    let b = bez(p0, p1, cp, u);
    let flip = q.flip + t * q.flip_velocity * (1.0 - u) * 0.35;
    let trail = (0..=12)
        .rev()
        .map(|j| {
            let b = bez(p0, p1, cp, in_out_cubic((raw - j as f64 * 0.022).max(0.0)));
            [b[0] + hx, b[1] + hy]
        })
        .collect();
    Flight {
        target: p1,
        position: [b[0] + hx, b[1] + hy],
        progress: raw,
        eased: u,
        scale: seeded::lerp(q.size, 0.28, u * u),
        spin: q.spin * (1.0 - u) + 0.25 * (t * 0.7 + q.k as f64).sin() * hov,
        flip,
        glint: (flip * 2.0 + glow_phase).cos().max(0.0).powi(22),
        glass: if ff { 1.0 - smooth(0.2, 0.6, raw) } else { 1.0 },
        firefly: if ff { smooth(0.15, 0.55, raw) } else { 0.0 },
        trail,
    }
}
pub fn landed_firefly(q: &Arrival, t: f64, target: [f64; 2]) -> ([f64; 2], f64) {
    let age = t - q.at;
    let an = q.angle + age * (0.7 + 0.6 * q.random) * q.side;
    let rad = 26.0 + 130.0 * (1.0 - (1.0 - (age / 1.4).clamp(0.0, 1.0)).powi(3));
    let ph = (t / 1.83 + q.random).fract();
    let blink = 0.35 + 0.65 * (-(ph.min(1.0 - ph) / 0.16).powi(2)).exp();
    (
        [
            target[0] + an.cos() * rad,
            target[1] + an.sin() * rad * 0.55 - 70.0 * age,
        ],
        blink,
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn beat_arrivals_stability_and_target_boundary() {
        let c = [
            Candidate {
                index: 5,
                coverage: 8.0,
            },
            Candidate {
                index: 2,
                coverage: 8.0,
            },
            Candidate {
                index: 8,
                coverage: 3.0,
            },
        ];
        let beats = [0.0, 0.49, 1.01, 1.54];
        let p = plan(&c, 3, &beats, 0.5, 0.0, 2.0).unwrap();
        assert_eq!((p[0].shard, p[1].shard, p[2].shard), (5, 2, 8));
        assert_eq!((p[0].at, p[1].at, p[2].at), (0.49, 1.01, 1.54));
        let f = flight(&p[0], p[0].at, [960.0, 400.0], [700.0, 850.0], 0.4, true);
        assert_eq!(f.position, [960.0, 400.0]);
        assert_eq!(f.glass, 0.0);
        assert_eq!(f.firefly, 1.0);
        assert_eq!(f.scale, 0.28);
        assert_eq!(f.trail.len(), 13);
        assert!(plan(&c, 0, &beats, 0.5, 0.0, 2.0).is_err());
    }
}
