//! Reference panel layout/punch/alternate/collapse policy over local recipe children.
#[path = "meta_panels_geometry.rs"]
mod geometry;
#[path = "meta_panel_lines.rs"]
mod lines;
#[path = "meta_paper.rs"]
mod paper;
use super::{ChildSample, Sample, child, inv, out_cubic, out_expo, rnds};
use crate::mv_recipe::model::Color;
use serde::{Deserialize, Serialize};
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Tone {
    pub c0: Option<Color>,
    pub c1: Option<Color>,
    pub dot: Option<Color>,
    pub sun: Option<[f64; 3]>,
    pub sun_color: Option<Color>,
    pub step: Option<f64>,
    pub density: Option<f64>,
    pub dot_a: Option<f64>,
    pub paper: Option<f64>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Punch {
    pub zoom: Option<f64>,
    pub focus: Option<[f64; 2]>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Variant {
    pub input: Option<String>,
    pub tone: Option<Tone>,
    pub focus: Option<[f64; 2]>,
    pub focus_to: Option<[f64; 2]>,
    pub zoom: Option<[f64; 2]>,
    pub lines: Option<String>,
    pub lines_at: Option<[f64; 2]>,
    pub lines_r: Option<[f64; 2]>,
    pub line_color: Option<Color>,
    pub impact_color: Option<Color>,
    pub lines_a: Option<f64>,
    pub lines_angle: Option<f64>,
    pub lines_n: Option<u32>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Panel {
    pub input: Option<String>,
    pub tone: Option<Tone>,
    pub alt: Option<Variant>,
    pub focus: Option<[f64; 2]>,
    pub focus_to: Option<[f64; 2]>,
    pub zoom: Option<[f64; 2]>,
    pub punch: Option<Punch>,
    #[serde(default)]
    pub disable_punch: bool,
    pub dir: Option<[f64; 2]>,
    pub lines: Option<String>,
    pub lines_at: Option<[f64; 2]>,
    pub lines_r: Option<[f64; 2]>,
    pub line_color: Option<Color>,
    pub impact_color: Option<Color>,
    pub lines_a: Option<f64>,
    pub lines_angle: Option<f64>,
    pub lines_n: Option<u32>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Layout {
    pub poly: Vec<[f64; 2]>,
    pub dir: Option<[f64; 2]>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Panels {
    pub panels: Vec<Panel>,
    pub collapse_at: Option<f64>,
    pub hero: Option<usize>,
    pub gutter: Option<f64>,
    pub margin: Option<f64>,
    pub gutter_color: Option<Color>,
    pub keyline: Option<Color>,
    pub keyline_a: Option<f64>,
    pub keyline_w: Option<f64>,
    pub open_at: Option<Vec<f64>>,
    pub open_dur: Option<f64>,
    pub order: Option<Vec<usize>>,
    pub layout: Option<Vec<Layout>>,
    pub collapse_dur: Option<f64>,
    pub collapse_zoom: Option<f64>,
    pub shake: Option<f64>,
    pub final_inset: Option<f64>,
    pub final_frame: Option<bool>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TonePlan {
    pub c0: Color,
    pub c1: Color,
    pub sun: Option<[f64; 3]>,
    pub sun_color: Color,
    pub dot_color: Color,
    pub dots: Vec<[f64; 3]>,
    pub paper_alpha: f64,
}
#[derive(Serialize)]
pub struct Border {
    pub poly: Vec<[f64; 2]>,
    pub color: Color,
    pub width: f64,
    pub dash: Option<[f64; 2]>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelPlan {
    pub child: Option<ChildSample>,
    pub tone: Option<TonePlan>,
    pub lines: Vec<lines::LinePlan>,
    pub pen: Option<Border>,
    pub clip: Vec<[f64; 2]>,
    pub translate: [f64; 2],
    pub transform: [f64; 6],
    pub flash: &'static str,
    pub leading: Option<[[f64; 2]; 2]>,
    pub leading_color: Color,
    pub keyline: Option<Border>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelsPlan {
    pub background: Color,
    pub page_shift: [f64; 2],
    pub panels: Vec<PanelPlan>,
    pub paper: Option<paper::Paper>,
    pub collapse_flash: f64,
    pub final_frame: Option<Border>,
    pub scratch_pixels: u64,
}
fn c(r: f64, g: f64, b: f64, a: f64) -> Color {
    [r / 255.0, g / 255.0, b / 255.0, a]
}
fn alpha(mut c: Color, a: f64) -> Color {
    c[3] *= a;
    c
}
fn color(c: &Color) -> bool {
    c.iter().all(|c| c.is_finite() && (0.0..=1.0).contains(c))
}
fn focus(p: &[f64; 2]) -> bool {
    p.iter()
        .all(|v| v.is_finite() && (-16.0..=16.0).contains(v))
}
fn zoom(p: &[f64; 2]) -> bool {
    p.iter().all(|v| v.is_finite() && (0.01..=16.0).contains(v))
}
fn tone(a: &Tone) -> Result<TonePlan, String> {
    for c in [a.c0, a.c1, a.dot, a.sun_color].into_iter().flatten() {
        if !color(&c) {
            return Err("Panels invalid tone color".into());
        }
    }
    for (v, min, max) in [
        (a.step, 8.0, 128.0),
        (a.density, 0.0, 2.0),
        (a.dot_a, 0.0, 1.0),
        (a.paper, 0.0, 1.0),
    ] {
        if v.is_some_and(|v| !v.is_finite() || v < min || v > max) {
            return Err("Panels invalid tone control".into());
        }
    }
    if a.sun.is_some_and(|p| {
        p.iter().any(|v| !v.is_finite())
            || p[0].abs() > 8192.0
            || p[1].abs() > 8192.0
            || p[2] <= 0.0
            || p[2] > 8192.0
    }) {
        return Err("Panels invalid tone sun".into());
    }
    let step = a.step.unwrap_or(13.0);
    let mut dots = Vec::new();
    let mut y = 0.0;
    while y < 1080.0 {
        let mut x = (((y / step).round() as i64) % 2) as f64 * step / 2.0;
        while x < 1920.0 {
            let mut v = (0.1 + 0.8 * ((y / 1080.0) * 0.75 + (1.0 - x / 1920.0) * 0.45) - 0.35)
                .clamp(0.0, 1.0);
            if let Some(s) = a.sun {
                if (x - s[0]).hypot(y - s[1]) / s[2] < 1.0 {
                    v = ((y - s[1]) / s[2]).clamp(0.0, 1.0) * 0.55;
                }
            }
            let r = v.powf(1.3) * a.density.unwrap_or(0.95) * step * 0.5;
            if r > 0.3 {
                dots.push([x, y, r]);
            }
            x += step;
        }
        y += step;
    }
    Ok(TonePlan {
        c0: a.c0.unwrap_or(c(200.0, 55.0, 58.0, 1.0)),
        c1: a.c1.unwrap_or(c(122.0, 35.0, 80.0, 1.0)),
        sun: a.sun,
        sun_color: a.sun_color.unwrap_or(c(246.0, 200.0, 142.0, 1.0)),
        dot_color: alpha(
            a.dot.unwrap_or(c(20.0, 11.0, 30.0, 1.0)),
            a.dot_a.unwrap_or(0.55),
        ),
        dots,
        paper_alpha: a.paper.unwrap_or(0.55),
    })
}
fn default_tone() -> Tone {
    Tone {
        c0: None,
        c1: None,
        dot: None,
        sun: None,
        sun_color: None,
        step: None,
        density: None,
        dot_a: None,
        paper: None,
    }
}
fn sine(k: f64) -> f64 {
    (1.0 - (k * std::f64::consts::PI).cos()) * 0.5
}
fn expo(k: f64) -> f64 {
    if k <= 0.0 {
        0.0
    } else if k >= 1.0 {
        1.0
    } else if k < 0.5 {
        2.0f64.powf(20.0 * k - 10.0) / 2.0
    } else {
        (2.0 - 2.0f64.powf(-20.0 * k + 10.0)) / 2.0
    }
}
impl Panels {
    /// Declaration-wide count, including hidden alternate tone content.
    pub fn expanded_work(&self) -> Result<usize, String> {
        self.validate()?;
        let mut work = 0usize;
        let mut paper = false;
        for p in &self.panels {
            let base = if p.input.is_none() {
                paper = true;
                16
            } else {
                0
            };
            let alt = if let Some(a) = &p.alt {
                if a.input.as_ref().or(p.input.as_ref()).is_none() {
                    paper = true;
                    16
                } else {
                    0
                }
            } else {
                0
            };
            work = work
                .checked_add(67 + base.max(alt))
                .ok_or("ReferencePanels work overflow")?;
        }
        Ok(work + if paper { 246 } else { 0 })
    }
    /// Single-path dots have a separate point/metadata bound, not uncharged work.
    pub fn plan_bytes_bound(&self) -> Result<u64, String> {
        self.validate()?;
        let mut bytes = 64 * 1024u64 + self.panels.len() as u64 * 128 * 1024;
        let mut paper = false;
        for p in &self.panels {
            lines::validate(
                p.lines.as_deref(),
                p.lines_at,
                p.lines_r,
                p.line_color,
                p.impact_color,
                p.lines_a,
                p.lines_angle,
                p.lines_n,
            )?;
            let mut count = 0usize;
            if p.input.is_none() {
                paper = true;
                count = tone(p.tone.as_ref().unwrap_or(&default_tone()))?.dots.len();
            }
            if let Some(a) = &p.alt {
                lines::validate(
                    a.lines.as_deref(),
                    a.lines_at,
                    a.lines_r,
                    a.line_color,
                    a.impact_color,
                    a.lines_a,
                    a.lines_angle,
                    a.lines_n,
                )?;
                if a.input.as_ref().or(p.input.as_ref()).is_none() {
                    paper = true;
                    count = count.max(
                        tone(
                            a.tone
                                .as_ref()
                                .or(p.tone.as_ref())
                                .unwrap_or(&default_tone()),
                        )?
                        .dots
                        .len(),
                    );
                }
            }
            if count > 32400 {
                return Err("ReferencePanels tone point limit exceeded".into());
            }
            bytes += count as u64 * 80;
        }
        if paper {
            bytes += 2_764_800 + 64 * 1024;
        }
        if bytes > 8 * 1024 * 1024 {
            return Err("ReferencePanels declared metadata exceeds8MiB".into());
        }
        Ok(bytes)
    }
    pub fn inputs(&self) -> Vec<&str> {
        self.panels
            .iter()
            .flat_map(|p| {
                p.input
                    .as_deref()
                    .into_iter()
                    .chain(p.alt.as_ref().and_then(|a| a.input.as_deref()))
            })
            .collect()
    }
    pub fn validate(&self) -> Result<(), String> {
        let n = self.panels.len();
        if !(1..=4).contains(&n) || self.hero.is_some_and(|h| h >= n) {
            return Err("ReferencePanels requires1..4 local panels and valid hero".into());
        }
        for id in self.inputs() {
            child(id, 0.0)?;
        }
        for (v, min, max) in [
            (self.gutter, 0.0, 256.0),
            (self.margin, 0.0, 256.0),
            (self.keyline_a, 0.0, 1.0),
            (self.keyline_w, 0.01, 64.0),
            (self.open_dur, 0.01, 10.0),
            (self.collapse_dur, 0.01, 10.0),
            (self.collapse_zoom, 0.0, 1.0),
            (self.shake, 0.0, 128.0),
            (self.final_inset, -256.0, 256.0),
            (self.collapse_at, 0.0, 21600.0),
        ] {
            if v.is_some_and(|v| !v.is_finite() || v < min || v > max) {
                return Err("ReferencePanels invalid framing control".into());
            }
        }
        for c in [self.gutter_color, self.keyline].into_iter().flatten() {
            if !color(&c) {
                return Err("ReferencePanels invalid color".into());
            }
        }
        if let Some(o) = &self.order {
            if o.len() != n || (0..n).any(|i| o.iter().filter(|j| **j == i).count() != 1) {
                return Err("ReferencePanels order must be permutation".into());
            }
        }
        if self.open_at.as_ref().is_some_and(|o| {
            o.len() != n
                || o.iter()
                    .any(|v| !v.is_finite() || !(0.0..=21600.0).contains(v))
                || o.windows(2).any(|w| w[0] >= w[1])
        }) {
            return Err("ReferencePanels invalid absolute opening times".into());
        }
        if self.layout.as_ref().is_some_and(|l| {
            l.len() != n
                || l.iter().any(|l| {
                    !geometry::convex(&l.poly)
                        || l.dir.is_some_and(|p| !focus(&p) || p == [0.0, 0.0])
                })
        }) {
            return Err("ReferencePanels custom layout must be bounded convex slots".into());
        }
        for p in &self.panels {
            for p in [p.focus, p.focus_to].into_iter().flatten() {
                if !focus(&p) {
                    return Err("ReferencePanels invalid focus".into());
                }
            }
            if p.zoom.is_some_and(|z| !zoom(&z))
                || p.dir.is_some_and(|p| !focus(&p) || p == [0.0, 0.0])
            {
                return Err("ReferencePanels invalid zoom/direction".into());
            }
            if let Some(a) = &p.tone {
                tone(a)?;
            }
            lines::validate(
                p.lines.as_deref(),
                p.lines_at,
                p.lines_r,
                p.line_color,
                p.impact_color,
                p.lines_a,
                p.lines_angle,
                p.lines_n,
            )?;
            if let Some(a) = &p.alt {
                lines::validate(
                    a.lines.as_deref(),
                    a.lines_at,
                    a.lines_r,
                    a.line_color,
                    a.impact_color,
                    a.lines_a,
                    a.lines_angle,
                    a.lines_n,
                )?;
                for p in [a.focus, a.focus_to].into_iter().flatten() {
                    if !focus(&p) {
                        return Err("ReferencePanels invalid alternate focus".into());
                    }
                }
                if a.zoom.is_some_and(|z| !zoom(&z)) {
                    return Err("ReferencePanels invalid alternate zoom".into());
                }
                if let Some(a) = &a.tone {
                    tone(a)?;
                }
            }
            if let Some(a) = &p.punch {
                if a.zoom
                    .is_some_and(|z| !z.is_finite() || !(0.01..=16.0).contains(&z))
                    || a.focus.is_some_and(|p| !focus(&p))
                {
                    return Err("ReferencePanels invalid punch".into());
                }
            }
        }
        Ok(())
    }
    pub fn plan(
        &self,
        s: &Sample<'_>,
        bpm: f64,
        width: u32,
        height: u32,
    ) -> Result<PanelsPlan, String> {
        self.plan_inner(s, bpm, width, height, true)
    }
    pub fn child_samples(
        &self,
        s: &Sample<'_>,
        bpm: f64,
        width: u32,
        height: u32,
    ) -> Result<Vec<Option<ChildSample>>, String> {
        Ok(self
            .plan_inner(s, bpm, width, height, false)?
            .panels
            .into_iter()
            .map(|p| p.child)
            .collect())
    }
    fn plan_inner(
        &self,
        s: &Sample<'_>,
        bpm: f64,
        width: u32,
        height: u32,
        paint: bool,
    ) -> Result<PanelsPlan, String> {
        self.validate()?;
        if (width, height) != (1920, 1080) || !bpm.is_finite() || !(1.0..=1000.0).contains(&bpm) {
            return Err("ReferencePanels requires exact1920x1080 and explicit BPM".into());
        }
        let (t, t0, t1) = super::time(s)?;
        let data = s
            .analysis
            .ok_or("ReferencePanels requires complete reviewed whole-song grid")?;
        data.validate()?;
        if data.beats.is_empty() {
            return Err("ReferencePanels needs real beats".into());
        }
        let bs: Vec<_> = data.beats.iter().map(|b| *b as f64 / 120000.0).collect();
        let n = self.panels.len();
        let order = self.order.clone().unwrap_or_else(|| match n {
            1 => vec![0],
            2 => vec![1, 0],
            3 => vec![1, 2, 0],
            _ => vec![1, 2, 3, 0],
        });
        let opens = if let Some(o) = &self.open_at {
            o.clone()
        } else {
            let mut out = vec![t0];
            let idx = bs.partition_point(|b| *b <= t0) as i64 - 1;
            for j in (idx - 1).max(0) as usize..bs.len().saturating_sub(1) {
                for e in [bs[j], (bs[j] + bs[j + 1]) / 2.0] {
                    if e > t0 + 0.06 && out.len() < n {
                        out.push(e);
                    }
                }
            }
            while out.len() < n {
                out.push(out.last().unwrap() + 30.0 / bpm);
            }
            out
        };
        let mut open_t = vec![0.0; n];
        for (i, slot) in order.iter().enumerate() {
            open_t[*slot] = opens[i];
        }
        let open_dur = self.open_dur.unwrap_or(0.36);
        let tc = self.collapse_at;
        let kc = tc.map_or(0.0, |tc| {
            expo(inv(tc - self.collapse_dur.unwrap_or(0.2), tc, t))
        });
        let after = tc.is_some_and(|tc| t >= tc);
        let hero = self.hero.unwrap_or(0);
        let margin = self.margin.unwrap_or(22.0);
        let slots: Vec<_> = if let Some(l) = &self.layout {
            l.iter()
                .map(|l| geometry::Slot {
                    poly: Some(l.poly.clone()),
                    lines: Vec::new(),
                    dir: l.dir.unwrap_or([1.0, 0.0]),
                })
                .collect()
        } else {
            geometry::defaults(n, self.gutter.unwrap_or(22.0))
        };
        let last = opens.iter().copied().fold(f64::NEG_INFINITY, f64::max);
        let mut punches = vec![Vec::new(); n];
        let mut j = 0;
        for b in &bs {
            if *b > last + open_dur * 0.5 && *b < tc.map_or(t1, |tc| tc - 0.08) {
                punches[order[j % n]].push(*b - 1.0 / 30.0);
                j += 1;
            }
        }
        let bi = bs.partition_point(|b| *b <= t) as i64 - 1;
        let beat_since = if bi >= 0 { t - bs[bi as usize] } else { 1e9 };
        let down0 = data
            .downbeats
            .first()
            .map_or(0, |b| data.beats.partition_point(|v| v < b) as i64);
        let down = (bi - down0).rem_euclid(4) == 0;
        let shk = self.shake.unwrap_or(7.0)
            * if down { (-9.0 * beat_since).exp() } else { 0.0 }
            * (1.0 - kc);
        let shift = if shk > 0.2 {
            let q = (t * 24.0).floor();
            [rnds(&[q, 5.0]) * shk, rnds(&[q, 12.0]) * shk]
        } else {
            [0.0, 0.0]
        };
        let hc = geometry::centroid(&geometry::poly(&slots[hero], margin, 0.0));
        let pen = self.keyline.unwrap_or(c(244.0, 239.0, 230.0, 1.0));
        let mut out = Vec::new();
        let mut has_tone = false;
        let draw_order: Vec<_> = order
            .iter()
            .copied()
            .filter(|i| *i != hero)
            .chain(std::iter::once(hero))
            .collect();
        for i in draw_order {
            if after && i != hero {
                continue;
            }
            let base = &self.panels[i];
            let kb = out_cubic(inv(open_t[i] - 0.16, open_t[i] + 0.08, t));
            let p0 = geometry::poly(&slots[i], margin, 0.0);
            let border = if kb > 0.0 && t < open_t[i] + open_dur {
                let per = p0
                    .iter()
                    .zip(p0.iter().cycle().skip(1))
                    .map(|(a, b)| (b[0] - a[0]).hypot(b[1] - a[1]))
                    .sum::<f64>();
                Some(Border {
                    poly: p0,
                    color: alpha(pen, 0.9),
                    width: 2.5,
                    dash: Some([per * kb, per + 10.0]),
                })
            } else {
                None
            };
            if t < open_t[i] - 1e-6 {
                if let Some(pen) = border {
                    out.push(PanelPlan {
                        child: None,
                        tone: None,
                        lines: Vec::new(),
                        pen: Some(pen),
                        clip: Vec::new(),
                        translate: [0.0, 0.0],
                        transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
                        flash: "none",
                        leading: None,
                        leading_color: pen_color(),
                        keyline: None,
                    });
                }
                continue;
            }
            let eo = out_expo(inv(open_t[i], open_t[i] + open_dur, t));
            let is_hero = i == hero;
            let full = geometry::poly(
                &slots[i],
                if is_hero {
                    margin + (-60.0 - margin) * kc
                } else {
                    margin
                },
                if is_hero { kc } else { 0.0 },
            );
            if full.len() < 3 {
                continue;
            }
            let d = geometry::norm(base.dir.unwrap_or(slots[i].dir));
            let lo = full
                .iter()
                .map(|p| p[0] * d[0] + p[1] * d[1])
                .fold(f64::INFINITY, f64::min);
            let hi = full
                .iter()
                .map(|p| p[0] * d[0] + p[1] * d[1])
                .fold(f64::NEG_INFINITY, f64::max);
            let clip = if eo >= 1.0 {
                full.clone()
            } else {
                geometry::clip(&full, d[0], d[1], lo + eo * (hi - lo + 2.0))
            };
            if clip.len() < 3 {
                continue;
            }
            let translate = if !is_hero && kc > 0.0 {
                let c = geometry::centroid(&full);
                let v = geometry::norm([c[0] - hc[0], c[1] - hc[1]]);
                [v[0] * kc * 520.0, v[1] * kc * 520.0]
            } else {
                [0.0, 0.0]
            };
            let past: Vec<_> = punches[i]
                .iter()
                .filter(|b| **b <= t + 1e-6)
                .copied()
                .collect();
            let variant = past.len() % 2 == 1;
            let since = past.last().map_or(1e9, |b| t - b);
            let alt = if variant { base.alt.as_ref() } else { None };
            let input = alt
                .and_then(|a| a.input.as_deref())
                .or(base.input.as_deref());
            let tones = alt.and_then(|a| a.tone.as_ref()).or(base.tone.as_ref());
            let z = alt
                .and_then(|a| a.zoom)
                .or(base.zoom)
                .unwrap_or([1.0, 1.06]);
            let pk = sine(inv(t0, t1, t));
            let mut zoom = z[0] + (z[1] - z[0]) * pk;
            let mut f = alt
                .and_then(|a| a.focus)
                .or(base.focus)
                .unwrap_or([0.5, 0.5]);
            if let Some(to) = alt.and_then(|a| a.focus_to).or(base.focus_to) {
                f = [f[0] + (to[0] - f[0]) * pk, f[1] + (to[1] - f[1]) * pk];
            }
            if variant && !base.disable_punch && base.alt.is_none() {
                zoom *= base.punch.as_ref().and_then(|a| a.zoom).unwrap_or(1.32);
                if let Some(p) = base.punch.as_ref().and_then(|a| a.focus) {
                    f = p;
                }
            }
            zoom *= 1.0 + 0.07 * (1.0 - out_expo((since / 0.22).clamp(0.0, 1.0)));
            zoom *= 1.0 + 0.09 * (1.0 - eo);
            if is_hero {
                if let Some(tc) = tc {
                    let mut r = 0.0;
                    for b in &bs {
                        if *b < tc - 0.05 {
                            continue;
                        }
                        if *b > t + 1.0 / 30.0 {
                            break;
                        }
                        r += out_expo(((t - (*b - 1.0 / 30.0)) / 0.16).clamp(0.0, 1.0));
                    }
                    zoom *= 1.0
                        + self.collapse_zoom.unwrap_or(0.045) * r
                        + if after {
                            0.018 * (-12.0 * beat_since).exp()
                        } else {
                            0.0
                        };
                }
            }
            let [x0, y0, x1, y1] = geometry::bounds(&full);
            let (bw, bh) = (x1 - x0, y1 - y0);
            let s = (bw / 1920.0).max(bh / 1080.0) * zoom;
            let (mut fx, mut fy) = (f[0] * 1920.0, f[1] * 1080.0);
            if input.is_some() {
                let (hw, hh) = (bw / 2.0 / s, bh / 2.0 / s);
                fx = fx.clamp(hw.min(960.0), (1920.0 - hw).max(960.0));
                fy = fy.clamp(hh.min(540.0), (1080.0 - hh).max(540.0));
            }
            let slide = (1.0 - eo) * 110.0;
            let transform = [
                s,
                0.0,
                0.0,
                s,
                (x0 + x1) / 2.0 - d[0] * slide - fx * s,
                (y0 + y1) / 2.0 - d[1] * slide - fy * s,
            ];
            let leading = if eo < 1.0 && eo > 0.0 {
                let c = lo + eo * (hi - lo + 2.0);
                let (ox, oy) = (d[0] * c, d[1] * c);
                Some([
                    [ox - d[1] * 3000.0, oy + d[0] * 3000.0],
                    [ox + d[1] * 3000.0, oy - d[0] * 3000.0],
                ])
            } else {
                None
            };
            let keyline = if is_hero && kc >= 1.0 {
                None
            } else {
                Some(Border {
                    poly: clip.clone(),
                    color: alpha(
                        pen,
                        self.keyline_a.unwrap_or(0.92) * if is_hero { 1.0 - kc } else { 1.0 },
                    ),
                    width: self.keyline_w.unwrap_or(3.5),
                    dash: None,
                })
            };
            let tone = if paint && input.is_none() {
                has_tone = true;
                Some(tone(tones.unwrap_or(&default_tone()))?)
            } else {
                None
            };
            out.push(PanelPlan {
                child: input.map(|id| child(id, t)).transpose()?,
                tone,
                lines: if paint {
                    let kind = alt
                        .and_then(|a| a.lines.as_deref())
                        .or(base.lines.as_deref());
                    let at = alt
                        .and_then(|a| a.lines_at)
                        .or(base.lines_at)
                        .unwrap_or([fx, fy]);
                    let radius = alt
                        .and_then(|a| a.lines_r)
                        .or(base.lines_r)
                        .unwrap_or([330.0, 396.0]);
                    let color = alt.and_then(|a| a.line_color).or(base.line_color);
                    let impact_color = alt.and_then(|a| a.impact_color).or(base.impact_color);
                    let alpha = alt.and_then(|a| a.lines_a).or(base.lines_a);
                    let angle = alt.and_then(|a| a.lines_angle).or(base.lines_angle);
                    let count = alt.and_then(|a| a.lines_n).or(base.lines_n);
                    lines::validate(
                        kind,
                        Some(at),
                        Some(radius),
                        color,
                        impact_color,
                        alpha,
                        angle,
                        count,
                    )?;
                    let impact = if is_hero {
                        tc.filter(|tc| t >= *tc - 1e-6)
                            .map_or(0.0, |tc| 1.0 - ((t - tc) / 0.45).clamp(0.0, 1.0))
                    } else {
                        0.0
                    };
                    let hw = bw / 2.0 / s;
                    let hh = bh / 2.0 / s;
                    lines::plan(
                        t,
                        i,
                        kind,
                        at,
                        radius,
                        color,
                        impact_color,
                        alpha,
                        angle,
                        count,
                        impact,
                        s,
                        [fx - hw, fy - hh, fx + hw, fy + hh],
                    )
                } else {
                    Vec::new()
                },
                pen: border,
                clip,
                translate,
                transform,
                flash: if since < 1.0 / 30.0 {
                    "negative"
                } else if since < 2.0 / 30.0 {
                    "paper"
                } else {
                    "none"
                },
                leading,
                leading_color: alpha(pen, 0.9 * (1.0 - eo)),
                keyline,
            });
        }
        let dt = tc.map_or(-1.0, |tc| t - tc);
        let kl = out_expo(((dt - 0.05) / 0.5).clamp(0.0, 1.0));
        let inset = -6.0 + (self.final_inset.unwrap_or(20.0) + 6.0) * kl;
        let final_frame = if dt >= -1e-6 && tc.is_some() && self.final_frame != Some(false) {
            Some(Border {
                poly: vec![
                    [inset, inset],
                    [1920.0 - inset, inset],
                    [1920.0 - inset, 1080.0 - inset],
                    [inset, 1080.0 - inset],
                ],
                color: alpha(pen, 0.85 * kl),
                width: 3.5,
                dash: None,
            })
        } else {
            None
        };
        let p = PanelsPlan {
            background: self.gutter_color.unwrap_or(c(20.0, 11.0, 30.0, 1.0)),
            page_shift: shift,
            panels: out,
            paper: if has_tone { Some(paper::plan()) } else { None },
            collapse_flash: if tc.is_some() && dt >= -1e-6 && dt < 0.1 {
                0.7 * (1.0 - dt / 0.1)
            } else {
                0.0
            },
            final_frame,
            scratch_pixels: 1920 * 1080 * 2 + 960 * 540,
        };
        if serde_json::to_vec(&p).map_err(|e| e.to_string())?.len() as u64
            > self.plan_bytes_bound()?
        {
            return Err("ReferencePanels frame metadata exceeds8MiB".into());
        }
        Ok(p)
    }
}
fn pen_color() -> Color {
    c(244.0, 239.0, 230.0, 1.0)
}
