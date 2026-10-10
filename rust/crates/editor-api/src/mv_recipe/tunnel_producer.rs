use super::{
    Sample,
    clock::Clock,
    draw::Draw,
    geometry::{self, Camera, Light},
    layers,
    math::*,
    model::{Metrics, Tunnel},
    objects,
    plan::Plan,
};
use serde::Serialize;
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Post {
    pub zoom_blur: f64,
    pub zoom_center: [f64; 2],
    pub bloom: f64,
    pub bloom_threshold: f64,
    pub ca: f64,
    pub vignette: f64,
    pub boil: f64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativePost {
    pub plan: crate::ReferencePostPlan,
    pub profile: &'static str,
    pub required: bool,
    pub song_ticks: u64,
    pub parameters: Post,
}
impl Tunnel {
    pub(in crate::mv_recipe) fn native_post(
        &self,
        s: &Sample<'_>,
        width: u32,
        height: u32,
    ) -> Result<NativePost, String> {
        let parameters = self.post(s)?;
        let plan = crate::build_reference_post_plan(
            width,
            height,
            i64::try_from(s.song_ticks).map_err(|_| "Tunnel post clock overflow")?,
            120000,
            &serde_json::to_value(&parameters).map_err(|e| e.to_string())?,
        )?;
        Ok(NativePost {
            plan,
            profile: "tunnel-original-gl-v1",
            required: true,
            song_ticks: s.song_ticks,
            parameters,
        })
    }
    pub(in crate::mv_recipe) fn produce(
        &self,
        s: &Sample<'_>,
        width: u32,
        height: u32,
        metrics: &Metrics,
    ) -> Result<Plan, String> {
        self.validate()?;
        if width == 0 || height == 0 || width > 8192 || height > 8192 {
            return Err("tunnel output dimensions exceed native admission".into());
        }
        metrics.validate()?;
        for (role, primary, fallback) in [
            ("mincho800", &self.fonts.mincho800, &self.fonts.noto800),
            ("dot400", &self.fonts.dot400, &self.fonts.noto400),
            ("heavy900", &self.fonts.heavy900, &self.fonts.noto900),
        ] {
            let stack = metrics
                .stacks
                .get(role)
                .ok_or("tunnel missing admitted font stack")?;
            if &stack.resources[0].id != primary || &stack.resources[1].id != fallback {
                return Err("tunnel metrics belong to different font settings".into());
            }
        }
        let c = Clock::new(self, s)?;
        let g = clamp(c.lt / c.dur).powf(2.3);
        let cam = Camera {
            vp: vp(c.lt),
            roll: c.roll(),
            f: self.f,
        };
        let rl = 26.0 + 1450.0 * g + 40.0 * c.pulse(7.0) + 90.0 * c.down_pulse(5.0) * g;
        let mut d = Draw::new(width as f64, height as f64);
        layers::background(&mut d, &c, &cam, g, rl);
        let objects = objects::build(self, &c)?;
        let travel_now = travel(c.lt, c.dur, self.v0, self.v1);
        let mut visible: Vec<_> = objects
            .iter()
            .filter_map(|o| {
                let z = o.radius.unwrap_or(1.6) * self.f / 1020.0
                    + travel(o.tc - c.start, c.dur, self.v0, self.v1)
                    - travel_now;
                if !(0.22..=22.0).contains(&z) {
                    None
                } else {
                    Some((z, o))
                }
            })
            .collect();
        // Stable sort preserves insertion order on equal depths like JS Array.sort.
        visible.sort_by(|p, q| q.0.total_cmp(&p.0));
        let mut visits = 0;
        let mut path_steps = 0;
        for (z, o) in visible {
            let rs = o.radius.unwrap_or(1.0) * self.f / z;
            let mut alpha =
                (1.0 - smooth(22.0 * 0.3, 22.0 * 0.95, z)) * (1.0 - smooth(1150.0, 1900.0, rs));
            if alpha < 0.01 {
                continue;
            }
            let silhouette = 1.0 - smooth(rl * 0.55, rl * 1.05, rs);
            let light = 1.0 - smooth(rl * 0.2, rl * 0.7, rs);
            alpha *= 1.0 - 0.75 * light * smooth(3.0, 10.0, z);
            let deep = smooth(5.0, 22.0 * 0.85, z);
            let color = mix(
                mix(rgb(0xffebd0), rgb(0x2a1430), silhouette),
                mix(rgb(0x7a68a8), rgb(0xf4b8a8), silhouette),
                deep * 0.55,
            );
            let passing = if o.beat {
                (-(c.t - o.tc).abs() * 9.0).exp()
            } else {
                0.0
            };
            let before = d.commands.len();
            geometry::draw(
                &mut d,
                o,
                z,
                c.lt,
                &cam,
                &Light {
                    rgb: color,
                    alpha,
                    silhouette,
                    passing,
                    glow: g,
                },
                metrics,
                &mut visits,
            )?;
            for command in &d.commands[before..] {
                if let super::plan::Command::Path { path, .. } = command {
                    path_steps += path.len();
                }
            }
            if path_steps > 262144 {
                return Err("tunnel path-step budget exceeded".into());
            }
            if d.commands.len() > 32768 {
                return Err("tunnel command budget exceeded".into());
            }
        }
        layers::dust(&mut d, self, &c, &cam, g);
        layers::finish(&mut d, self, &c, &cam, g, metrics);
        let plan = Plan {
            commands: d.commands,
        };
        for command in &plan.commands {
            if let super::plan::Command::StackText {
                font_stack, text, ..
            } = command
            {
                if text
                    .chars()
                    .any(|ch| !font_stack.routes.contains_key(&ch.to_string()))
                {
                    return Err("tunnel text is outside byte-proven font coverage".into());
                }
            }
        }
        if plan.commands.len() > 32768 {
            return Err("tunnel final command budget exceeded".into());
        }
        // Final serialized size also bounds command/path/string aggregate overhead.
        let bytes = serde_json::to_vec(&plan).map_err(|e| e.to_string())?;
        if bytes.len() > 16 * 1024 * 1024 {
            return Err("tunnel native plan exceeds 16MiB".into());
        }
        Ok(plan)
    }
    pub(in crate::mv_recipe) fn post(&self, s: &Sample<'_>) -> Result<Post, String> {
        self.validate()?;
        let c = Clock::new(self, s)?;
        let p = clamp(c.lt / c.dur);
        let g = p.powf(2.4);
        let center = vp(c.lt);
        let settle = 1.0 - smooth(c.dur - 0.9, c.dur - 0.2, c.lt);
        Ok(Post {
            zoom_blur: (0.008 + 0.03 * p + 0.02 * c.pulse(10.0)) * (0.08 + 0.92 * settle),
            zoom_center: [center[0] / 1920.0, center[1] / 1080.0],
            bloom: 0.42 + 0.15 * g,
            bloom_threshold: 0.72 + 0.12 * g,
            ca: 1.2,
            vignette: 0.2,
            boil: 0.6,
        })
    }
}
