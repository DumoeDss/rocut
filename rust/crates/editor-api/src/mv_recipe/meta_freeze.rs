use super::{child, crack, inv, out_cubic, out_expo, rnd, ChildSample, Sample};
use serde::{Deserialize, Serialize};
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Freeze {
    pub at: Option<f64>,
    pub live: Option<bool>,
    pub crack_at: Option<f64>,
    pub crack_xy: Option<[f64; 2]>,
    pub crack_angle: Option<f64>,
    pub crack_seed: Option<u32>,
    pub desat_end: Option<f64>,
    pub desat: Option<f64>,
    pub push: Option<f64>,
    pub jitter: Option<f64>,
    pub split: Option<f64>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Frame {
    pub transform: [f64; 6],
    pub clip: Option<Vec<[f64; 2]>>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stroke {
    pub paths: Vec<Vec<[f64; 2]>>,
    pub color: &'static str,
    pub width: f64,
    pub blur: f64,
    pub composite: &'static str,
    pub joined: bool,
}
#[derive(Serialize)]
pub struct Glow {
    pub center: [f64; 2],
    pub radius: f64,
    pub color: &'static str,
    pub alpha: f64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FreezePlan {
    pub child: ChildSample,
    pub live: bool,
    pub frames: Vec<Frame>,
    pub grey_mix: f64,
    pub cold_alpha: f64,
    pub flicker_alpha: f64,
    pub strokes: Vec<Stroke>,
    pub glows: Vec<Glow>,
    pub scratch_pixels: u64,
}
impl Freeze {
    pub fn child_sample(&self, input: &str, s: &Sample<'_>) -> Result<ChildSample, String> {
        self.validate()?;
        let (t, t0, _) = super::time(s)?;
        let at = self.at.unwrap_or(t0);
        let end = self.desat_end.unwrap_or(self.crack_at.unwrap_or(at + 1.1));
        if end <= at {
            return Err("Freeze desatEnd/crackAt must follow held sample".into());
        }
        child(
            input,
            if t < at && self.live != Some(false) {
                t
            } else {
                at
            },
        )
    }
    pub fn expanded_work(&self) -> Result<usize, String> {
        self.validate()?;
        let Some(_) = self.crack_at else {
            return Ok(8);
        };
        let g = crack::geometry(
            self.crack_seed.unwrap_or(23),
            self.crack_xy.unwrap_or([1920.0 * 0.57, 1080.0 * 0.43]),
            self.crack_angle.unwrap_or(-0.58),
        );
        Ok(16
            + g.main.len() * 2
            + g.halves.iter().map(|p| p.len() * 2).sum::<usize>()
            + g.branches.iter().map(|p| p.len()).sum::<usize>()
            + g.ring.len() * 2)
    }
    pub fn validate(&self) -> Result<(), String> {
        for v in [self.at, self.crack_at, self.desat_end]
            .into_iter()
            .flatten()
        {
            if !v.is_finite() || !(0.0..=21600.0).contains(&v) {
                return Err("Freeze invalid absolute song seconds".into());
            }
        }
        for (v, min, max) in [
            (self.desat, 0.0, 1.0),
            (self.push, -0.5, 4.0),
            (self.jitter, 0.0, 64.0),
            (self.split, 0.0, 512.0),
            (self.crack_angle, -100.0, 100.0),
        ] {
            if v.is_some_and(|v| !v.is_finite() || v < min || v > max) {
                return Err("Freeze invalid style control".into());
            }
        }
        if self
            .crack_xy
            .is_some_and(|p| p.iter().any(|v| !v.is_finite() || v.abs() > 8192.0))
        {
            return Err("Freeze invalid crack anchor".into());
        }
        Ok(())
    }
    pub fn plan(
        &self,
        input: &str,
        s: &Sample<'_>,
        width: u32,
        height: u32,
    ) -> Result<FreezePlan, String> {
        self.validate()?;
        if (width, height) != (1920, 1080) {
            return Err("Freeze requires exact1920x1080".into());
        }
        let (t, t0, t1) = super::time(s)?;
        let at = self.at.unwrap_or(t0);
        let live = t < at && self.live != Some(false);
        let end = self.desat_end.unwrap_or(self.crack_at.unwrap_or(at + 1.1));
        if end <= at {
            return Err("Freeze desatEnd/crackAt must follow held sample".into());
        }
        let mut p = FreezePlan {
            child: self.child_sample(input, s)?,
            live,
            frames: Vec::new(),
            grey_mix: 0.0,
            cold_alpha: 0.0,
            flicker_alpha: 0.0,
            strokes: Vec::new(),
            glows: Vec::new(),
            scratch_pixels: 1920 * 1080 * 3,
        };
        if live {
            if serde_json::to_vec(&p).map_err(|e| e.to_string())?.len() > 256 * 1024 {
                return Err("Freeze frame metadata exceeds256KiB".into());
            }
            return Ok(p);
        }
        let k = out_cubic(inv(at, end, t)) * self.desat.unwrap_or(0.88);
        let q = (t * 12.0 + 1e-6).floor();
        let ph = if q as i64 % 2 != 0 { 1.0 } else { -1.0 };
        let jit = self.jitter.unwrap_or(1.2) * ((t - at) / 0.1).clamp(0.0, 1.0);
        let push = 1.0
            + self.push.unwrap_or(0.025)
                * (1.0 - (std::f64::consts::PI * inv(at, t1 + 0.4, t)).cos())
                * 0.5;
        let a = ph * 0.0007 * jit;
        let frame = |dx: f64, dy: f64, clip| Frame {
            transform: [
                a.cos() * push,
                a.sin() * push,
                -a.sin() * push,
                a.cos() * push,
                960.0 + ph * jit * 0.9 + dx,
                540.0 - ph * jit * 0.55 + dy,
            ],
            clip,
        };
        p.grey_mix = k;
        p.cold_alpha = 0.26 * k;
        p.flicker_alpha = 0.05 * rnd(&[q, 77.0]) * ((t - at) / 0.2).clamp(0.0, 1.0);
        let dt = self.crack_at.map_or(-1.0, |v| t - v);
        let c = self.crack_xy.unwrap_or([1920.0 * 0.57, 1080.0 * 0.43]);
        let ang = self.crack_angle.unwrap_or(-0.58);
        let geo = self
            .crack_at
            .map(|_| crack::geometry(self.crack_seed.unwrap_or(23), c, ang));
        if dt < 0.06 {
            p.frames.push(frame(0.0, 0.0, None));
        } else {
            let g = geo.as_ref().ok_or("Freeze missing crack geometry")?;
            let sep = self.split.unwrap_or(8.0)
                * out_cubic(((dt - 0.06) / (t1 - self.crack_at.unwrap()).max(0.2)).clamp(0.0, 1.0))
                + 1.2;
            for sg in [1.0, -1.0] {
                let (nx, ny) = (-ang.sin(), ang.cos());
                let e0 = g.main[0];
                let e1 = *g.main.last().unwrap();
                let mut poly = g.main.clone();
                poly.push([e1[0] + nx * sg * 5000.0, e1[1] + ny * sg * 5000.0]);
                poly.push([e0[0] + nx * sg * 5000.0, e0[1] + ny * sg * 5000.0]);
                p.frames
                    .push(frame(nx * sg * sep / 2.0, ny * sg * sep / 2.0, Some(poly)));
            }
        }
        if let Some(g) = geo.filter(|_| dt >= 0.0) {
            let grow = out_expo((dt / 0.1).clamp(0.0, 1.0)) * g.reach;
            let sep = if dt < 0.06 {
                0.0
            } else {
                self.split.unwrap_or(8.0)
                    * out_cubic(
                        ((dt - 0.06) / (t1 - self.crack_at.unwrap()).max(0.2)).clamp(0.0, 1.0),
                    )
            };
            let paths: Vec<_> = g.halves.iter().map(|h| crack::upto(h, grow)).collect();
            p.strokes.push(Stroke {
                paths: paths.clone(),
                color: "rgba(255,226,180,0.22)",
                width: 6.0 + sep * 1.6,
                blur: 5.0,
                composite: "lighter",
                joined: false,
            });
            p.strokes.push(Stroke {
                paths,
                color: "#FBF6EE",
                width: 1.5 + sep * 0.7,
                blur: 0.0,
                composite: "source-over",
                joined: false,
            });
            let mut paths: Vec<_> = g.branches.iter().map(|b| crack::upto(b, grow)).collect();
            p.strokes.push(Stroke {
                paths,
                color: "rgba(255,250,240,0.85)",
                width: 1.1,
                blur: 0.0,
                composite: "source-over",
                joined: false,
            });
            if grow > 60.0 {
                p.strokes.push(Stroke {
                    paths: g.ring,
                    color: "rgba(255,250,240,0.85)",
                    width: 1.1,
                    blur: 0.0,
                    composite: "source-over",
                    joined: true,
                });
            }
            for (radius, color, alpha, dur) in
                [(380.0, "#FFE3B0", 0.8, 0.35), (60.0, "#FFFFFF", 0.9, 0.5)]
            {
                let k = (dt / dur).clamp(0.0, 1.0);
                p.glows.push(Glow {
                    center: c,
                    radius,
                    color,
                    alpha: alpha * (1.0 - k).powi(2),
                });
            }
        }
        let bytes = serde_json::to_vec(&p).map_err(|e| e.to_string())?.len();
        if bytes > 256 * 1024 {
            return Err("Freeze serialized frame exceeds256KiB".into());
        }
        Ok(p)
    }
}
