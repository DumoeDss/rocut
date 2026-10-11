use super::{
    ChildSample, Sample, child,
    math::{Rng, noise},
    rnd,
};
use serde::{Deserialize, Serialize};
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Melt {
    pub at: Option<f64>,
    pub live: Option<bool>,
    pub rate: Option<f64>,
    pub melt_at: Option<f64>,
    pub melt_end: Option<f64>,
    pub cols: Option<u32>,
    pub seed: Option<u32>,
    pub depth: Option<f64>,
    pub drip: Option<f64>,
    pub drops: Option<u32>,
}
#[derive(Serialize)]
pub struct Column {
    pub x: f64,
    pub width: f64,
    pub y: f64,
    pub cool: f64,
    pub echoes: Vec<[f64; 2]>,
    pub front: Option<[f64; 2]>,
}
#[derive(Serialize)]
pub struct Drop {
    pub rect: [f64; 4],
    pub center: [f64; 2],
    pub radius: f64,
    pub alpha: f64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeltPlan {
    pub child: ChildSample,
    pub columns: Vec<Column>,
    pub drops: Vec<Drop>,
    pub top_stops: Vec<(f64, &'static str)>,
    pub top_alpha: f64,
    pub blue_alpha: f64,
    pub stop_alpha: f64,
    pub scratch_pixels: u64,
}
fn fbm(x: f64, seed: f64) -> f64 {
    let mut v = 0.0;
    let mut a = 0.5;
    let mut fr = 1.0;
    for o in 0..3 {
        v += a * noise(x * fr, seed + o as f64 * 17.0);
        a *= 0.5;
        fr *= 2.0;
    }
    v
}
fn range(r: &mut Rng, a: f64, b: f64) -> f64 {
    a + (b - a) * r.next()
}
struct Col {
    x: f64,
    w: f64,
    d: f64,
    s: f64,
}
fn columns(seed: u32, n: u32) -> Vec<Col> {
    let mut r = Rng::new(seed as f64);
    let avg = 1920.0 / n as f64;
    let (mut x, mut out) = (0.0_f64, Vec::new());
    while x < 1920.0 {
        let w = (1920.0 - x).min((avg * range(&mut r, 0.55, 1.45)).round().max(4.0));
        let xc = (x + w / 2.0) / 1920.0;
        let d = 0.34 * (0.5 + 0.5 * fbm(xc * 3.2, seed as f64))
            + 0.12 * (0.5 + 0.5 * noise(xc * 17.0, seed as f64 + 1.0))
            + 0.035 * r.next();
        let fast = if r.next() < 0.09 {
            range(&mut r, 1.35, 1.7)
        } else {
            1.0
        };
        let s = (0.78 + 0.44 * (0.5 + 0.5 * fbm(xc * 7.5, seed as f64 + 3.0)))
            * fast
            * range(&mut r, 0.93, 1.07);
        out.push(Col {
            x,
            w,
            d: d.clamp(0.0, 0.6),
            s,
        });
        x += w;
    }
    out
}
impl Melt {
    pub fn child_sample(&self, input: &str, s: &Sample<'_>) -> Result<ChildSample, String> {
        self.validate()?;
        let (t, t0, t1) = super::time(s)?;
        if self.melt_end.unwrap_or(t1) <= self.melt_at.unwrap_or(t0 + 0.45) {
            return Err("Melt requires meltEnd after meltAt".into());
        }
        let at = self.at.unwrap_or(t0);
        child(
            input,
            if self.live == Some(true) {
                at + (t - t0) * self.rate.unwrap_or(0.25)
            } else {
                at
            },
        )
    }
    pub fn expanded_work(&self) -> Result<usize, String> {
        self.validate()?;
        let n = columns(self.seed.unwrap_or(5), self.cols.unwrap_or(128)).len();
        Ok(n * 13 + self.drops.unwrap_or(46) as usize * 2 + 16)
    }
    pub fn validate(&self) -> Result<(), String> {
        for v in [self.at, self.melt_at, self.melt_end].into_iter().flatten() {
            if !v.is_finite() || !(0.0..=21600.0).contains(&v) {
                return Err("Melt invalid absolute song seconds".into());
            }
        }
        for (v, min, max) in [
            (self.rate, -8.0, 8.0),
            (self.depth, 0.0, 8.0),
            (self.drip, 0.0, 8.0),
        ] {
            if v.is_some_and(|v| !v.is_finite() || v < min || v > max) {
                return Err("Melt invalid liquid control".into());
            }
        }
        if self.cols.is_some_and(|n| !(1..=480).contains(&n)) || self.drops.is_some_and(|n| n > 256)
        {
            return Err("Melt bounded columns/drops exceeded".into());
        }
        Ok(())
    }
    pub fn plan(
        &self,
        input: &str,
        s: &Sample<'_>,
        width: u32,
        height: u32,
    ) -> Result<MeltPlan, String> {
        self.validate()?;
        if (width, height) != (1920, 1080) {
            return Err("Melt requires exact1920x1080".into());
        }
        let (t, t0, t1) = super::time(s)?;
        let m0 = self.melt_at.unwrap_or(t0 + 0.45);
        let m1 = self.melt_end.unwrap_or(t1);
        if m1 <= m0 {
            return Err("Melt requires meltEnd after meltAt".into());
        }
        let tau = (t - m0) / (m1 - m0);
        let depth = self.depth.unwrap_or(0.95);
        let drip = self.drip.unwrap_or(0.42);
        let cs = columns(self.seed.unwrap_or(5), self.cols.unwrap_or(128));
        let mut out = Vec::new();
        for c in &cs {
            let l = (tau - c.d).max(0.0) / (1.0 - c.d);
            let y = 1080.0 * depth * c.s * l.powf(2.5);
            let dl = 1080.0 * drip * c.s * l.powf(1.3);
            let mut echoes = Vec::new();
            if y > 3.0 {
                let tr = y.min(40.0 + y * 0.35);
                for k in 1..=3 {
                    echoes.push([y - tr * k as f64 / 3.0, 0.5 * (1.0 - k as f64 / 4.0)]);
                }
            }
            if dl > 3.0 {
                for k in 1..=7 {
                    echoes.push([y + dl * k as f64 / 7.0, 0.95 * (1.0 - (k - 1) as f64 / 8.0)]);
                }
            }
            out.push(Column {
                x: c.x,
                width: c.w,
                y,
                cool: (l * 1.35).clamp(0.0, 1.0),
                echoes,
                front: if l > 0.0 {
                    Some([y, 22.0 + 50.0 * (l * 2.0).clamp(0.0, 1.0)])
                } else {
                    None
                },
            });
        }
        let mut drops = Vec::new();
        for q in 0..self.drops.unwrap_or(46) {
            let q = q as f64;
            let c = &cs[(rnd(&[q, 71.0]) * cs.len() as f64).floor() as usize];
            let td = c.d + (1.0 - c.d) * (0.12 + (0.85 - 0.12) * rnd(&[q, 72.0]));
            let td0 = m0 + td * (m1 - m0);
            if t < td0 {
                continue;
            }
            let ld = (td - c.d) / (1.0 - c.d);
            let y0 = 1080.0 * depth * c.s * ld.powf(2.5) + 8.0;
            let dt = t - td0;
            let yy = y0 + 1300.0 * (0.35 + 0.65 * rnd(&[q, 73.0])) * dt * dt;
            if yy > 1140.0 {
                continue;
            }
            let xx = c.x + c.w * rnd(&[q, 74.0]);
            let len = (6.0 + 2600.0 * dt * 0.045).min(140.0);
            let r = 1.6 + 2.2 * rnd(&[q, 75.0]);
            drops.push(Drop {
                rect: [xx - r * 0.5, yy - len, r, len],
                center: [xx, yy],
                radius: r * 6.0,
                alpha: 0.85 * (dt / 0.08).clamp(0.0, 1.0),
            });
        }
        let tk = tau.clamp(0.0, 1.0);
        let p = MeltPlan {
            child: self.child_sample(input, s)?,
            columns: out,
            drops,
            top_stops: vec![
                (0.0, "rgba(1,3,9,0.9)"),
                (0.3 * tk + 0.06, "rgba(1,3,9,0.3)"),
                (0.45 * tk + 0.14, "rgba(1,3,9,0)"),
            ],
            top_alpha: (tk * 2.2).clamp(0.0, 1.0),
            blue_alpha: 0.22 * tk,
            stop_alpha: if tau < 0.0 {
                0.12 * ((t - t0) / 0.3).clamp(0.0, 1.0)
            } else {
                0.0
            },
            scratch_pixels: 1920 * 1080 * 4 + 1920 * 60,
        };
        if serde_json::to_vec(&p).map_err(|e| e.to_string())?.len() > 512 * 1024 {
            return Err("Melt frame metadata exceeds512KiB".into());
        }
        Ok(p)
    }
}
