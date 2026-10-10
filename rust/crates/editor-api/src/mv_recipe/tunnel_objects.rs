use super::{
    clock::Clock,
    math::*,
    model::{LATIN, Tunnel},
};
pub(super) enum Kind {
    Text(String),
    Latin(&'static str),
    Dial,
    Circle,
    Frame,
    Cross,
}
pub(super) struct Object {
    pub kind: Kind,
    pub tc: f64,
    pub radius: Option<f64>,
    pub gs: f64,
    pub tilt: [f64; 2],
    pub spin: f64,
    pub phase: f64,
    pub beat: bool,
    pub x: f64,
    pub y: f64,
    pub size: f64,
    pub rot: f64,
}
impl Object {
    fn new(kind: Kind, tc: f64, radius: Option<f64>) -> Self {
        Self {
            kind,
            tc,
            radius,
            gs: 0.0,
            tilt: [0.0; 2],
            spin: 0.0,
            phase: 0.0,
            beat: false,
            x: 0.0,
            y: 0.0,
            size: 0.0,
            rot: 0.0,
        }
    }
}
fn word(a: &Tunnel, c: &Clock, tc: f64) -> String {
    if let Some(p) = &a.plan {
        let mut w = &p[0].1;
        for (t, ww) in p {
            if tc >= *t {
                w = ww;
            }
        }
        return w.clone();
    }
    let w = &a.words;
    let i = if w.len() >= 5 {
        if tc < c.start + 0.95 {
            1
        } else if tc < c.start + 3.05 {
            0
        } else if tc < c.end - 0.2 {
            2
        } else {
            3
        }
    } else {
        ((clamp((tc - c.start) / c.dur) * w.len() as f64).floor() as usize).min(w.len() - 1)
    };
    w[i].clone()
}
pub(super) fn build(a: &Tunnel, c: &Clock) -> Result<Vec<Object>, String> {
    let bs: Vec<_> = c
        .beats
        .iter()
        .copied()
        .filter(|b| *b > c.start - 1.5 && *b < c.end + 5.0)
        .collect();
    if bs.len() > 2048 {
        return Err("tunnel crossing beat window exceeds 2048".into());
    }
    let mut out = vec![];
    for (i, b) in bs.iter().copied().enumerate() {
        let bi = c.beat(b + 1e-4);
        let n = bi as f64;
        let ib = c.in_bar(b + 1e-4);
        let sp = bs.get(i + 1).copied().unwrap_or(b + 0.46) - b;
        if ib % 2 == 0 || (b - c.end).abs() < 0.06 {
            let mut o = Object::new(Kind::Text(word(a, c, b)), b, Some(1.6));
            o.gs = if ib == 0 { 0.34 } else { 0.27 };
            o.tilt = [rnds(n, 1.0) * 0.2, rnds(n, 2.0) * 0.2];
            o.spin = if bi % 4 != 0 { 1.0 } else { -1.0 } * (0.1 + 0.08 * rnd(n, 3.0));
            o.phase = rnd(n, 4.0) * TAU;
            o.beat = true;
            out.push(o);
        } else {
            let mut o = Object::new(Kind::Dial, b, Some(1.9));
            o.tilt = [rnds(n, 21.0) * 0.15, rnds(n, 22.0) * 0.15];
            o.spin = 0.22 * if bi % 4 == 1 { 1.0 } else { -1.0 };
            o.phase = rnd(n, 8.0) * TAU;
            o.beat = true;
            out.push(o);
            let mut o = Object::new(
                Kind::Latin(LATIN[(rnd(n, 9.0) * 5.0).floor() as usize]),
                b + sp * 0.22,
                Some(1.12),
            );
            o.gs = 0.07;
            o.spin = -0.28;
            o.phase = rnd(n, 10.0) * TAU;
            out.push(o);
        }
        let mut o = Object::new(Kind::Circle, b + sp * 0.5, Some(1.3 + 0.9 * rnd(n, 5.0)));
        o.tilt = [rnds(n, 6.0) * 0.3, rnds(n, 7.0) * 0.3];
        out.push(o);
        // JavaScript signed remainder is deliberate here; don't rem_euclid bi.
        if bi % 4 == 1 || bi % 4 == 3 {
            let mut o = Object::new(Kind::Cross, b + sp * 0.7, None);
            o.x = if bi % 8 < 4 { -1.0 } else { 1.0 } * (1.55 + 0.5 * rnd(n, 12.0));
            o.y = rnds(n, 13.0) * 0.9;
            o.size = 0.8 + 0.3 * rnd(n, 14.0);
            o.rot = rnds(n, 15.0) * 0.25;
            out.push(o);
        }
        if bi % 4 == 2 {
            let mut o = Object::new(Kind::Frame, b + sp * 0.62, Some(2.3));
            o.rot = if rnd(n, 16.0) < 0.5 {
                std::f64::consts::FRAC_PI_4
            } else {
                0.0
            };
            out.push(o);
        }
    }
    Ok(out)
}
