use super::{
    evaluate::{lerp, progress},
    model::{Ease, Oscillation, Pose, Span, Sprite, SpritePlan},
    sprite_model::{Entrance, Slice, Underlay},
    validate::{color, range, span},
};

fn oscillator(o: &Option<Oscillation>, max: f64) -> bool {
    o.as_ref().is_none_or(|o| {
        range(o.amplitude, 0.0, max)
            && range(o.frequency, 0.0, 60.0)
            && range(o.phase, -100.0, 100.0)
    })
}
fn pose(p: &Pose) -> bool {
    range(p.x, -4.0, 4.0)
        && range(p.y, -4.0, 4.0)
        && range(p.height, 0.001, 8.0)
        && range(p.rotation, -100.0, 100.0)
        && range(p.opacity, 0.0, 1.0)
}
fn entrance(e: &Entrance, frames: u32) -> bool {
    span(&e.span, frames)
        && e.offset.iter().all(|v| range(*v, -4.0, 4.0))
        && range(e.scale, 0.01, 4.0)
        && range(e.rotation, -100.0, 100.0)
        && range(e.opacity, 0.0, 1.0)
}
fn underlay(e: &Underlay) -> bool {
    color(&e.color) && e.offset.iter().all(|v| range(*v, -1.0, 1.0)) && range(e.blur, 0.0, 0.05)
}
fn oscillate(o: &Option<Oscillation>, t: f64) -> f64 {
    o.as_ref().map_or(0.0, |o| {
        (t * std::f64::consts::TAU * o.frequency + o.phase).sin() * o.amplitude
    })
}
impl Sprite {
    pub(super) fn valid(&self, frames: u32) -> bool {
        pose(&self.from)
            && super::audio::sprite_valid(&self.audio)
            && pose(&self.to)
            && self.anchor.iter().all(|v| range(*v, 0.0, 1.0))
            && self.drawing_fps.is_none_or(|f| f > 0 && f <= 120)
            && oscillator(&self.sway, 1.0)
            && oscillator(&self.breathe, 0.5)
            && self.enter.as_ref().is_none_or(|e| entrance(e, frames))
            && self.exit.as_ref().is_none_or(|e| entrance(e, frames))
            && self
                .enter
                .as_ref()
                .zip(self.exit.as_ref())
                .is_none_or(|(a, b)| {
                    a.span.start_frame + a.span.duration_frames <= b.span.start_frame
                })
            && self.wave.as_ref().is_none_or(|w| {
                range(w.amplitude, 0.0, 0.25)
                    && range(w.from, 0.0, 0.99)
                    && range(w.cycles, 0.0, 16.0)
                    && range(w.frequency, 0.0, 60.0)
                    && range(w.phase, -100.0, 100.0)
                    && (1..=128).contains(&w.strips)
            })
            && self.shadow.as_ref().is_none_or(underlay)
            && self.rim.as_ref().is_none_or(underlay)
            && self.silhouette.as_ref().is_none_or(color)
            && self.glow.as_ref().is_none_or(|g| {
                color(&g.color)
                    && g.offset.iter().all(|v| range(*v, -4.0, 4.0))
                    && range(g.radius, 0.001, 4.0)
            })
    }
    pub(super) fn needs_surface(&self) -> bool {
        self.wave.is_some()
            || self.shadow.is_some()
            || self.rim.is_some()
            || self.silhouette.is_some()
            || self.glow.is_some()
    }
    pub(super) fn work(&self) -> u32 {
        let underlays = u32::from(self.shadow.is_some()) + u32::from(self.rim.is_some());
        self.wave.as_ref().map_or(1, |w| w.strips) * (1 + underlays)
            + underlays * 2
            + u32::from(self.silhouette.is_some())
            + u32::from(self.glow.is_some()) * 2
            + u32::from(self.needs_surface()) * 2
    }
    pub(super) fn resolve(
        &self,
        t: f64,
        frame: f64,
        motion: &Span,
        easing: Ease,
        data: Option<&crate::mv_audio::Data>,
        song: f64,
    ) -> Result<SpritePlan, String> {
        let p = progress(frame, motion, easing);
        let mut pose = Pose {
            x: lerp(self.from.x, self.to.x, p),
            y: lerp(self.from.y, self.to.y, p),
            height: lerp(self.from.height, self.to.height, p) * (1.0 + oscillate(&self.breathe, t)),
            rotation: lerp(self.from.rotation, self.to.rotation, p) + oscillate(&self.sway, t),
            opacity: lerp(self.from.opacity, self.to.opacity, p),
        };
        super::audio::sprite(&self.audio, &mut pose, data, song, t)?;
        for (e, entering) in [(&self.enter, true), (&self.exit, false)] {
            if let Some(e) = e {
                let q = progress(frame, &e.span, e.easing);
                let q = if entering { 1.0 - q } else { q };
                pose.x += e.offset[0] * q;
                pose.y += e.offset[1] * q;
                pose.height *= lerp(1.0, e.scale, q);
                pose.rotation += e.rotation * q;
                pose.opacity *= lerp(1.0, e.opacity, q);
            }
        }
        Ok(SpritePlan {
            image: self.image.clone(),
            role: self.role,
            anchor: self.anchor,
            flip: self.flip,
            pose,
            slices: self.wave.as_ref().map(|w| {
                (0..w.strips)
                    .map(|i| {
                        let start = f64::from(i) / f64::from(w.strips);
                        let k = ((start - w.from) / (1.0 - w.from)).clamp(0.0, 1.0);
                        Slice {
                            start,
                            end: f64::from(i + 1) / f64::from(w.strips),
                            offset: w.amplitude
                                * k
                                * k
                                * (start * w.cycles * std::f64::consts::TAU
                                    - t * w.frequency * std::f64::consts::TAU
                                    + w.phase)
                                    .sin(),
                        }
                    })
                    .collect()
            }),
            shadow: self.shadow.clone(),
            rim: self.rim.clone(),
            silhouette: self.silhouette,
            glow: self.glow.clone(),
        })
    }
}
