use super::{
    Sample, clock::Clock, disc, draw::*, ease::hit, glyphs, images, labels, model::TitleRiff,
    ornaments, palette::palette, particles, plan::*, raster::*, state::State, textures,
};
use crate::{mv_font_metrics, mv_image_dimensions};

// These caps are independent from the ordinary generator-command budget. The
// reference's rotated print screens contain tens of thousands of real arcs.
pub(super) const MAX_PATH_STEPS: usize = 100_000;
pub(super) const MAX_DRAW_COMMANDS: usize = 2000;

impl TitleRiff {
    pub(in crate::mv_recipe) fn produce(
        &self,
        sample: &Sample<'_>,
        width: u32,
        height: u32,
        fonts: &mv_font_metrics::Context,
        decoded: &mv_image_dimensions::Context,
    ) -> Result<Plan, String> {
        // Every named resource, including currently hidden recap branches, must
        // have verified decoded facts before any frame can be considered ready.
        self.runtime_ready(sample, fonts, decoded)?;
        let clock = Clock::new(self, sample)?;
        let state = State::new(self, &clock);
        let p = palette(self.outro());
        let items = glyphs::layouts(self, &clock, &state);
        let labels = labels::labels(self, &clock, &state, p.hi, p.glow);
        let mut out = Vec::new();
        textures::paper(&mut out);
        textures::background(
            &mut out,
            &p,
            self.outro(),
            state.x,
            state.y,
            state.radius,
            clock.pulse,
        );
        glyphs::monuments(&mut out, self, &state, &p, &items, fonts)?;
        let mut back = Draw::new(1920.0, 1080.0);
        blit(
            &mut back,
            "title-background",
            [1920, 1080],
            FRAME,
            "source-over",
            1.0,
            0.0,
            "low",
        );
        back.operations = state.camera.clone();
        ornaments::measure(&mut back, self, &clock, &state, &p);
        ornaments::crossbuck(&mut back, self, &clock, &state, &p);
        glyphs::draw(&mut back, self, &state, &p, &items, fonts)?;
        surface(&mut out, "title-back", [1920, 1080], back);
        release(&mut out, "title-background");
        if state.lock < 0.999 {
            for item in &items {
                release(&mut out, item.surface);
            }
        }
        let radius = state.radius * (1.0 + state.exit * 6.5);
        let halftone = !self.outro() && radius >= 1.0;
        if halftone {
            textures::halftone(&mut out, "title-half-9", p.sunset, 9.0);
        }
        let mask = if disc::needs_mask(self, &clock, &state) {
            Some(images::masks(&mut out, self, &p, decoded)?)
        } else {
            None
        };
        let mut front = Draw::new(1920.0, 1080.0);
        blit(
            &mut front,
            "title-back",
            [1920, 1080],
            FRAME,
            "source-over",
            1.0,
            0.0,
            "low",
        );
        front.operations = state.camera.clone();
        let glow = 0.5 + 0.5 * clock.pulse + hit(clock.time, clock.at(self.cues.sun), 3.0);
        let r = state.radius * 2.6;
        front.rect(
            [state.x - r, state.y - r, r * 2.0, r * 2.0],
            fill(
                radial_between(
                    [state.x, state.y, state.radius * 0.9],
                    [state.x, state.y, r],
                    &[
                        (0.0, rgba(p.sunset, 0.34 * glow)),
                        (0.3, rgba(p.verm, 0.12 * glow)),
                        (1.0, rgba(p.dusk, 0.0)),
                    ],
                ),
                "lighter",
            ),
        );
        disc::draw(&mut front, self, &clock, &state, &p, decoded, mask)?;
        ornaments::rings(&mut front, self, &clock, &state, &p, &labels, fonts)?;
        if self.outro() {
            disc::recap(
                &mut front, self, &clock, &state, &p, decoded, &labels, fonts,
            )?;
        }
        particles::draw(&mut front, self, &clock, &state, &p);
        front.operations.clear();
        ornaments::lockup(&mut front, self, &clock, &p, &labels, fonts)?;
        super::grain::draw(&mut front, clock.time, self.grain);
        ornaments::hud(&mut front, self, &clock, &state, &p, &labels, fonts)?;
        let flash = 0.6 * hit(clock.time, clock.at(self.cues.sun), 34.0)
            + 0.3 * hit(clock.time, clock.at(self.cues.zan), 40.0)
            + 0.3 * hit(clock.time, clock.at(self.cues.ko), 40.0)
            + 0.4 * hit(clock.time, clock.at(self.cues.lock), 30.0);
        if flash > 0.01 {
            let mut paint = fill(solid(p.hi), "lighter");
            paint.opacity = flash.min(0.8);
            front.rect(FRAME, paint);
        }
        if self.cues.neg >= 0
            && clock.time - clock.at(self.cues.neg) >= 0.0
            && clock.time - clock.at(self.cues.neg) < 0.07
        {
            front.rect(FRAME, fill(solid([1.0; 4]), "difference"));
        }
        if !self.outro() && self.exit && state.exit > 0.0 {
            let mut paint = fill(solid(p.hi), "source-over");
            paint.opacity = 0.9 * state.exit.powi(3);
            front.rect(FRAME, paint);
        }
        surface(&mut out, "title-front", [1920, 1080], front);
        release(&mut out, "title-back");
        if halftone {
            release(&mut out, "title-half-9");
        }
        if mask.is_some() {
            release(&mut out, "title-sky-cutout");
            release(&mut out, "title-rim");
        }
        let mut target = Draw::new(width as f64, height as f64);
        blit(
            &mut target,
            "title-front",
            [1920, 1080],
            FRAME,
            "source-over",
            1.0,
            0.0,
            "low",
        );
        out.extend(target.commands);
        release(&mut out, "title-front");
        let plan = Plan { commands: out };
        let (commands, steps) = work(&plan.commands);
        if commands > MAX_DRAW_COMMANDS || steps > MAX_PATH_STEPS {
            return Err("titleRiff exceeds explicit primitive/path-step budget".into());
        }
        plan.validate_surfaces(self.scratch_pixels(Some(decoded))?)?;
        let encoded = serde_json::to_vec(&plan).map_err(|e| e.to_string())?;
        if encoded.len() > super::budget::MAX_PLAN_BYTES {
            return Err("titleRiff exceeds admitted4MiB serialized plan/copy budget".into());
        }
        Ok(plan)
    }
}
pub(super) fn work(commands: &[Command]) -> (usize, usize) {
    // Preserve the expanded rectangle work charge even though Canvas receives
    // its original native primitive instead of five polygon steps.
    let path_steps = |path: &[Step]| {
        path.iter()
            .map(|step| {
                if matches!(step, Step::Rect { .. }) {
                    5
                } else {
                    1
                }
            })
            .sum::<usize>()
    };
    let clip_steps = |clip: &Option<Clip>| clip.as_ref().map_or(0, |v| path_steps(&v.path));
    let (mut count, mut steps) = (0, 0);
    for command in commands {
        count += 1;
        match command {
            Command::CircleBatch { circles, clip, .. } => {
                steps += 2 * circles.len() + clip_steps(clip);
            }
            Command::Surface { commands, .. } => {
                let (nested, vertices) = work(commands);
                count += nested;
                steps += vertices;
            }
            Command::Path { path, clip, .. } => {
                steps += path_steps(path) + clip_steps(clip);
            }
            Command::Rect { clip, paint, .. } => {
                steps += clip_steps(clip)
                    + if matches!(paint.kind, PaintKind::Stroke { .. }) {
                        5
                    } else {
                        0
                    };
            }
            Command::Image { clip, .. } | Command::Blit { clip, .. } => {
                steps += clip_steps(clip);
            }
            _ => {}
        }
    }
    (count, steps)
}
