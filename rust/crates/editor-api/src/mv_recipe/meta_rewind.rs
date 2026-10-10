use super::{child, inv, rnd, rnds, ChildSample, Sample};
use crate::{
    mv_font_metrics::{AdvanceRequest, Context, Request},
    programmatic_resources::Resource,
};
use serde::{Deserialize, Serialize};
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Rewind {
    pub span: Option<f64>,
    pub from: Option<f64>,
    pub follow: Option<bool>,
    pub fps: Option<u32>,
    pub hold: Option<f64>,
    pub tail: Option<f64>,
    pub osd: Option<bool>,
    pub osd_font: Option<String>,
}
/// Root derives these from this recipe's authored nodes/spans; never caller facts.
pub struct ShotCandidate<'a> {
    pub input: &'a str,
    pub start_ticks: u64,
    pub is_reference: bool,
}
#[derive(Serialize)]
pub struct Blit {
    pub source: [f64; 4],
    pub destination: [f64; 4],
    pub alpha: f64,
}
#[derive(Serialize)]
pub struct Text {
    pub text: String,
    pub position: [f64; 2],
    pub size: f64,
    pub align: &'static str,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Osd {
    pub font_id: String,
    pub texts: Vec<Text>,
    pub arrows: Vec<Vec<[f64; 2]>>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RewindPlan {
    pub child: Option<ChildSample>,
    pub strips: Vec<Blit>,
    pub snow: Vec<Blit>,
    pub dropouts: Vec<[f64; 4]>,
    pub slip: f64,
    pub scanlines: Vec<[u32; 4]>,
    pub static_rgba: Vec<u8>,
    pub osd: Option<Osd>,
    pub scratch_pixels: u64,
}
impl Rewind {
    fn transport(&self, s: &Sample<'_>) -> Result<(f64, f64, i64, f64, bool, f64), String> {
        for v in [self.span, self.from, self.hold, self.tail]
            .into_iter()
            .flatten()
        {
            if !v.is_finite() || v < 0.0 || v > 21600.0 {
                return Err("Rewind invalid transport parameter".into());
            }
        }
        if self.hold.is_some_and(|v| v > 10.0)
            || self.tail.is_some_and(|v| v > 60.0)
            || self.fps.is_some_and(|v| !(1..=120).contains(&v))
        {
            return Err("Rewind invalid transport parameter".into());
        }
        let (t, t0, t1) = super::time(s)?;
        let data = s
            .analysis
            .ok_or("Rewind requires complete reviewed whole-song beat evidence")?;
        data.validate()?;
        if data.beats.is_empty() {
            return Err("Rewind requires real whole-song beat grid".into());
        }
        let fps = f64::from(self.fps.unwrap_or(15));
        let tq = (t * fps + 1e-6).floor() / fps;
        let fr = (tq * 15.0 + 1e-6).floor();
        let bi = data.beats.partition_point(|b| *b as f64 / 120000.0 <= tq) as i64 - 1;
        let lb = if bi >= 0 {
            data.beats[bi as usize] as f64 / 120000.0
        } else {
            -1.0
        };
        let catching = lb > t0 + 0.05 && tq - lb < self.hold.unwrap_or(0.1);
        let u = inv(
            t0,
            t0 + (t1 - t0 - self.tail.unwrap_or(0.12)).max(0.2),
            if catching { lb } else { tq },
        );
        let ts = self.from.unwrap_or(t0) - self.span.unwrap_or(3.0) * (0.1 * u + 0.9 * u.powf(1.8))
            + rnds(&[fr, 5.0]) * 0.012;
        Ok((tq, fr, bi, lb, catching, ts))
    }
    pub fn child_sample(
        &self,
        input: &str,
        self_id: &str,
        s: &Sample<'_>,
        candidates: &[ShotCandidate<'_>],
    ) -> Result<Option<ChildSample>, String> {
        let (_, _, _, _, _, ts) = self.transport(s)?;
        let base = candidates
            .iter()
            .find(|c| c.input == input)
            .ok_or("Rewind local base child missing from canonical shot candidates")?;
        let selected =
            if ts >= base.start_ticks as f64 / 120000.0 - 1e-6 || self.follow == Some(false) {
                base
            } else {
                candidates
                    .iter()
                    .filter(|c| {
                        c.input != self_id
                            && !c.is_reference
                            && c.start_ticks as f64 / 120000.0 <= ts + 1e-6
                    })
                    .max_by_key(|c| c.start_ticks)
                    .unwrap_or(base)
            };
        Ok(Some(child(selected.input, ts)?))
    }
    pub fn validate(&self, resources: &[Resource]) -> Result<(), String> {
        for (v, min, max) in [
            (self.span, 0.0, 21600.0),
            (self.from, 0.0, 21600.0),
            (self.hold, 0.0, 10.0),
            (self.tail, 0.0, 60.0),
        ] {
            if v.is_some_and(|v| !v.is_finite() || v < min || v > max) {
                return Err("Rewind invalid transport parameter".into());
            }
        }
        if self.fps.is_some_and(|v| !(1..=120).contains(&v)) {
            return Err("Rewind fps must be integer1..120".into());
        }
        if self.osd != Some(false) {
            let id = self
                .osd_font
                .as_deref()
                .ok_or("Rewind OSD requires explicit physical DotGothic16 font")?;
            let r = resources
                .iter()
                .find(|r| r.id == id && r.kind == "font")
                .ok_or("Rewind OSD physical font missing")?;
            let d = serde_json::to_value(r).map_err(|e| e.to_string())?;
            if d["font"]["family"] != "DotGothic16"
                || d["font"]["weight"] != 400
                || d["font"]["style"] != "normal"
            {
                return Err("Rewind OSD requires actual normal400 DotGothic16".into());
            }
        } else if self.osd_font.is_some() {
            return Err("Rewind disabled OSD forbids unused font binding".into());
        }
        Ok(())
    }
    pub(crate) fn font_requests(&self, resources: &[Resource]) -> Result<Vec<Request>, String> {
        self.validate(resources)?;
        let Some(id) = &self.osd_font else {
            return Ok(Vec::new());
        };
        Ok(vec![Request {
            resource: resources.iter().find(|r| r.id == *id).unwrap().clone(),
            glyphs: "REWSP:0123456789".chars().map(|c| c.to_string()).collect(),
            advances: vec![AdvanceRequest {
                text: "REW".into(),
                font_size_px: 64.0,
                letter_spacing_px: 0.0,
            }],
            bounds: Vec::new(),
        }])
    }
    pub(crate) fn plan(
        &self,
        input: &str,
        self_id: &str,
        s: &Sample<'_>,
        candidates: &[ShotCandidate<'_>],
        resources: &[Resource],
        fonts: Option<&Context>,
        width: u32,
        height: u32,
    ) -> Result<RewindPlan, String> {
        self.validate(resources)?;
        if (width, height) != (1920, 1080) {
            return Err("Rewind requires exact1920x1080".into());
        }
        let (tq, fr, bi, lb, catching, ts) = self.transport(s)?;
        let (t, _, _) = super::time(s)?;
        let slip = if catching && tq - lb < 0.07 {
            34.0 + 20.0 * rnd(&[bi as f64, 9.0])
        } else {
            0.0
        };
        let bands: Vec<_> = (0..3)
            .map(|b| {
                let b = b as f64;
                let v = rnd(&[b, 3.0]) - tq * (0.42 + 0.35 * b) * if b == 2.0 { -0.5 } else { 1.0 };
                (
                    (v - v.floor()) * 1380.0 - 150.0,
                    26.0 + 70.0 * rnd(&[b, 5.0, ((fr as i64) >> 2) as f64]),
                    if b == 2.0 { 0.45 } else { 1.0 },
                )
            })
            .collect();
        let mut strips = Vec::new();
        for y in (0..1080).step_by(6) {
            let y = y as f64;
            let mut dx = rnds(&[y, fr]) * 1.8;
            for (by, bh, bs) in &bands {
                let w = (-((y - by) / bh).powi(2)).exp();
                if w > 0.02 {
                    dx += w * bs * (26.0 + 40.0 * rnds(&[((y as i64) >> 3) as f64, fr, 1.0]));
                }
            }
            if y > 1056.0 {
                dx += 38.0 + 20.0 * rnds(&[y, fr, 2.0]);
            }
            strips.push(Blit {
                source: [0.0, y, 1920.0, 6.0],
                destination: [dx, y - slip, 1920.0, 6.0],
                alpha: 1.0,
            });
        }
        let mut snow = Vec::new();
        for (by, bh, bs) in &bands {
            snow.push(Blit {
                source: [
                    rnd(&[fr, 1.0, *by]) * 300.0,
                    rnd(&[fr, 2.0]) * 180.0,
                    320.0,
                    60.0,
                ],
                destination: [0.0, by - bh * 0.6, 1920.0, bh * 1.2],
                alpha: 0.5 * bs,
            });
        }
        snow.push(Blit {
            source: [rnd(&[fr, 7.0]) * 300.0, 0.0, 320.0, 12.0],
            destination: [0.0, 1058.0, 1920.0, 22.0],
            alpha: 0.3,
        });
        let dropouts = (0..26)
            .map(|d| {
                let d = d as f64;
                let (by, bh, _) = bands[d as usize % 3];
                [
                    rnd(&[d, fr, 3.0]) * 1920.0,
                    by + rnds(&[d, fr]) * bh * 0.8,
                    20.0 + 160.0 * rnd(&[d, fr, 4.0]).powi(2),
                    1.6,
                ]
            })
            .collect();
        let osd = if let Some(id) = &self.osd_font {
            let tw = fonts
                .ok_or("Rewind OSD requires actual measured font facts")?
                .advance(id, "REW", 64.0, 0.0)?;
            let x = 118.0 + rnds(&[fr, 11.0]) * 1.5;
            let y = 128.0 - slip;
            let mut arrows = Vec::new();
            if (t * 3.0).floor() as i64 % 2 == 0 || !catching {
                for j in 0..2 {
                    let x = x + tw + 26.0 + j as f64 * 38.0;
                    arrows.push(vec![[x, y], [x + 40.0, y - 25.0], [x + 40.0, y + 25.0]]);
                }
            }
            let time = ts.max(0.0);
            Some(Osd {
                font_id: id.clone(),
                texts: vec![
                    Text {
                        text: "REW".into(),
                        position: [x, y],
                        size: 64.0,
                        align: "left",
                    },
                    Text {
                        text: format!(
                            "0:{:02}:{:02}",
                            (time / 60.0).floor() as u32,
                            (time % 60.0).floor() as u32
                        ),
                        position: [1800.0, 960.0 - slip],
                        size: 44.0,
                        align: "right",
                    },
                    Text {
                        text: "SP".into(),
                        position: [118.0, 960.0 - slip],
                        size: 44.0,
                        align: "left",
                    },
                ],
                arrows,
            })
        } else {
            None
        };
        let p = RewindPlan {
            child: self.child_sample(input, self_id, s, candidates)?,
            strips,
            snow,
            dropouts,
            slip,
            scanlines: (0..1080).step_by(4).map(|y| [0, y + 2, 1920, 2]).collect(),
            static_rgba: static_rgba(),
            osd,
            scratch_pixels: 1920 * 1080 * 3 + 960 * 1080 + 200 * 112 + 640 * 256,
        };
        if serde_json::to_vec(&p).map_err(|e| e.to_string())?.len() > 4 * 1024 * 1024 {
            return Err("Rewind frame metadata exceeds4MiB".into());
        }
        Ok(p)
    }
}
fn static_rgba() -> Vec<u8> {
    let mut r = super::math::Rng::new(4410.0);
    let mut bytes = Vec::with_capacity(640 * 256 * 4);
    for _ in 0..256 {
        let row = 0.35 + 0.65 * r.next();
        for _ in 0..640 {
            let v = if r.next() < 0.5 {
                0.0
            } else {
                255.0 * r.next().powf(0.6) * row
            };
            let v = super::clamped_byte(v);
            bytes.extend_from_slice(&[v, v, v, 255]);
        }
    }
    bytes
}
