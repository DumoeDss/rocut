use super::model::*;
use crate::{model::Issue, programmatic_resources::Resource};
use std::collections::{BTreeMap, BTreeSet};

pub(super) fn range(v: f64, min: f64, max: f64) -> bool {
    v.is_finite() && v >= min && v <= max
}
pub(super) fn color(c: &Color) -> bool {
    c.iter().all(|v| range(*v, 0.0, 1.0))
}
fn roles(r: &[Role]) -> bool {
    !r.is_empty() && r.len() <= 4 && r.iter().collect::<BTreeSet<_>>().len() == r.len()
}
pub(super) fn camera(c: &Camera) -> bool {
    range(c.x, -1.0, 1.0) && range(c.y, -1.0, 1.0) && range(c.zoom, 1.0, 8.0)
}
pub(super) fn span(s: &Span, frames: u32) -> bool {
    s.duration_frames > 0
        && s.start_frame
            .checked_add(s.duration_frames)
            .is_some_and(|v| v <= frames)
}

#[derive(Default)]
struct ExpandedWork {
    drawing: u32,
    primitives: u32,
    simulation: u64,
    plan_pixels: u64,
}

impl Recipe {
    pub fn validate(
        &self,
        resources: &[Resource],
        frames: u32,
        width: u32,
        height: u32,
        step: u64,
    ) -> Vec<Issue> {
        match self.check_with_images(resources, frames, width, height, step, None) {
            Ok(()) => Vec::new(),
            Err(message) => vec![Issue::new("editing.programmatic.recipe", &message)],
        }
    }
    pub(crate) fn check_with_images(
        &self,
        resources: &[Resource],
        frames: u32,
        width: u32,
        height: u32,
        step: u64,
        images: Option<&crate::mv_image_dimensions::Context>,
    ) -> Result<(), String> {
        if width == 0 || height == 0 || width > 4096 || height > 4096 {
            return Err("MV recipe dimensions must be 1..4096".into());
        }
        if self.version != 1
            || !range(self.song_start_seconds, 0.0, 1_000_000.0)
            || !roles(&self.output_roles)
        {
            return Err("Unsupported MV recipe version, song start or unique output roles".into());
        }
        if self.nodes.is_empty() || self.nodes.len() > 32 || self.post.len() > 8 {
            return Err("MV recipe requires 1..32 nodes and at most 8 post groups".into());
        }
        let mut nodes = BTreeMap::new();
        let image = |id: &str| resources.iter().any(|r| r.id == id && r.kind == "image");
        if self.audio.as_ref().is_some_and(|a| {
            !crate::mv_audio::digest(&a.input_sha256)
                || !resources
                    .iter()
                    .any(|r| r.id == a.resource && r.kind == "analysis")
        }) {
            return Err(
                "MV audio binding requires a declared analysis resource and source-audio digest"
                    .into(),
            );
        }
        let mut uses_audio = false;
        let mut decorated = false;
        let mut surface = false;
        let mut afterimage_scratch = 0;
        for n in &self.nodes {
            if n.id.is_empty()
                || n.id.len() > 64
                || !n
                    .id
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
                || nodes.insert(n.id.as_str(), &n.scene).is_some()
            {
                return Err(
                    "MV node IDs must be unique 1..64 ASCII letters, digits, hyphen or underscore"
                        .into(),
                );
            }
            let valid = match &n.scene {
                Scene::Flame {settings,span:s,..} => {
                    uses_audio |= settings.uses_audio();
                    afterimage_scratch=afterimage_scratch.max(settings.scratch_pixels(images)?);
                    settings.valid((self.song_start_seconds*120000.0).round() as u64,s,step)
                        &&settings.resources_valid(resources)&&span(s,frames)
                }
                Scene::Fall {settings,span:s,..} => {
                    uses_audio |= settings.uses_audio();
                    afterimage_scratch=afterimage_scratch.max(settings.scratch_pixels(images)?);
                    settings.valid((self.song_start_seconds*120000.0).round() as u64,s,step)
                        &&settings.resources_valid(resources)&&span(s,frames)
                }
                Scene::Thread {settings,span:s,..} => {
                    uses_audio |= settings.uses_audio();
                    afterimage_scratch=afterimage_scratch.max(settings.scratch_pixels(images)?);
                    settings.valid((self.song_start_seconds*120000.0).round() as u64,s,step)
                        &&settings.resources_valid(resources)&&span(s,frames)
                }
                Scene::KanjiSlam {settings,span:s,..} => {
                    uses_audio |= settings.uses_audio();
                    afterimage_scratch=afterimage_scratch.max(settings.scratch_pixels(images)?);
                    settings.valid((self.song_start_seconds*120000.0).round() as u64,s,step)
                        &&settings.resources_valid(resources)&&span(s,frames)
                }
                Scene::TitleRiff {settings,span:s,..} => {
                    uses_audio |= settings.uses_audio();
                    afterimage_scratch=afterimage_scratch.max(settings.scratch_pixels(images)?);
                    settings.valid((self.song_start_seconds*120000.0).round() as u64,s,step)
                        &&settings.resources_valid(resources)&&span(s,frames)
                }
                Scene::Ember { settings, span: s, .. } => {
                    uses_audio |= settings.uses_audio();
                    afterimage_scratch = afterimage_scratch.max(settings.scratch_pixels());
                    settings.valid((self.song_start_seconds * 120_000.0).round() as u64, s, step)
                        && settings.resources_valid(resources) && span(s, frames)
                }
                Scene::Converge { settings, span: s, .. } => {
                    uses_audio |= settings.uses_audio();
                    afterimage_scratch = afterimage_scratch.max(settings.scratch_pixels());
                    settings.valid((self.song_start_seconds * 120_000.0).round() as u64, s, step)
                        && span(s, frames)
                }
                Scene::TypeCard { settings, span: s, .. } => {
                    uses_audio |= settings.uses_audio();
                    afterimage_scratch = afterimage_scratch.max(settings.scratch_pixels(width, height));
                    settings.valid() && settings.resources_valid(resources) && span(s, frames)
                        && u64::from(s.duration_frames).checked_mul(step).is_some()
                }
                Scene::Afterimage { settings, span: s, .. } => {
                    afterimage_scratch = afterimage_scratch.max(settings.scratch_pixels(width, height));
                    settings.valid() && settings.resources_valid(resources) && span(s, frames)
                        && u64::from(s.duration_frames).checked_mul(step).is_some()
                }
                Scene::ImageSequence { sequence, origin_source_ticks, rate, view, .. } => {
                    resources.iter().any(|r| r.id == *sequence && r.kind == "imageSequence")
                        && origin_source_ticks.unsigned_abs() <= crate::image_sequence::MAX_SAFE
                        && rate.valid_playback() && camera(view)
                },
                Scene::Cloth {
                    settings, span: s, ..
                } => {
                    surface = true;
                    settings.valid()
                        && image(&settings.image)
                        && span(s, frames)
                        && u64::from(s.duration_frames)
                            .checked_mul(step)
                            .is_some_and(|ticks| settings.valid_duration(ticks))
                }
                Scene::Shatter {
                    settings, span: s, ..
                } => {
                    surface = true;
                    settings.valid() && image(&settings.image) && span(s, frames)
                }
                Scene::Grid {
                    settings, span: s, ..
                } => {
                    surface = true;
                    settings.valid() && image(&settings.image) && span(s, frames)
                }
                Scene::HexFloat {
                    settings, span: s, ..
                } => {
                    surface = true;
                    settings.valid()
                        && settings.work(f64::from(width), f64::from(height))
                            <= super::catalog::GENERATOR_PRIMITIVES
                        && image(&settings.image)
                        && span(s, frames)
                }
                Scene::AsciiSweep {
                    settings, span: s, ..
                } => {
                    settings.valid()
                        && settings.fits(f64::from(width), f64::from(height))
                        && resources
                            .iter()
                            .any(|r| r.id == settings.font && r.kind == "font")
                        && span(s, frames)
                }
                Scene::ParticleScroll {
                    settings, span: s, ..
                } => settings.valid() && image(&settings.image) && span(s, frames),
                Scene::GlyphRain { settings, .. } => {
                    settings.valid()
                        && resources
                            .iter()
                            .any(|r| r.id == settings.font && r.kind == "font")
                }
                Scene::ParticleReveal {
                    settings, span: s, ..
                } => settings.valid() && image(&settings.image) && span(s, frames),
                Scene::Ref { time_map, .. } => super::reference::valid_map(time_map, frames),
                Scene::Sequence { items } => super::reference::valid_sequence(items, frames),
                Scene::Panels {
                    panels,
                    collapse,
                    border,
                } => super::panels::valid(panels, collapse, border, frames),
                Scene::Solid { color: c, .. } => color(c),
                Scene::Illust {
                    motion,
                    background,
                    sprites,
                    ..
                } => {
                    decorated |= sprites.iter().any(Sprite::needs_surface);
                    uses_audio |= sprites.iter().any(|s| !s.audio.is_empty())
                        || background.as_ref().is_some_and(|b| !b.audio.is_empty());
                    span(motion, frames)
                        && background.as_ref().is_none_or(|b| {
                            image(&b.image)
                                && camera(&b.from)
                                && camera(&b.to)
                                && super::audio::camera_valid(&b.audio)
                        })
                        && sprites.len() <= 32
                        && (background.is_some() || !sprites.is_empty())
                        && sprites.iter().all(|s| image(&s.image) && s.valid(frames))
                }
                Scene::Transition { span: s, style, .. } => {
                    surface |= matches!(
                        style,
                        super::transition_model::Transition::Peel { .. }
                            | super::transition_model::Transition::Bend { .. }
                    );
                    span(s, frames) && style.valid()
                }
            };
            if !valid {
                return Err(format!(
                    "Invalid MV scene parameters or undeclared image: {}",
                    n.id
                ));
            }
        }
        let mut post_passes = 0;
        let mut spatial = false;
        let mut light_leak_scratch = 0;
        for p in &self.post {
            uses_audio |= !p.audio.is_empty();
            if !p.valid_target()
                || p.effects.is_empty()
                || p.effects.len() > 8
                || !p.effects.iter().all(Effect::valid)
                || !super::post_automation::valid(&p.automation, &p.effects, frames)
                || !super::audio::post_valid(&p.audio, &p.effects)
            {
                return Err(
                    "Invalid MV post stage/targets, effect parameters or count (1..8)".into(),
                );
            }
            spatial |= p.effects.iter().any(Effect::spatial);
            light_leak_scratch = light_leak_scratch.max(
                p.effects
                    .iter()
                    .map(Effect::light_leak_scratch)
                    .max()
                    .unwrap_or(0),
            );
            post_passes += p.render_passes();
        }
        if post_passes > 128 {
            return Err("MV post exceeds 128 combined role/composite rendering passes".into());
        }
        if uses_audio && self.audio.is_none() {
            return Err("Audio responses require an explicit reviewed analysis binding".into());
        }
        // Validate the whole graph, including disconnected authoring nodes. Limit
        // expanded work as well as unique nodes: a small DAG can grow exponentially.
        self.font_metric_requests(resources)?;
        let image_requests = self.image_dimension_requests(resources)?;
        // Discovery charges known surfaces/plan/encoded copies only; unknown
        // decoded sizes are deferred, never replaced by authored dimensions.
        // Every resident image requires facts before programmatic.rs can issue
        // a plan. Final admission reruns this same whole-source budget with
        // exact decoded dimensions, including dimension-dependent masks.
        // Requests cover the raster backend's complete resident declared-image
        // set; encoded copies and decoded pixels are charged once per ID, not
        // once per scene reference. The separate decoder cap also remains.
        let image_scratch = if image_requests.is_empty() { 0 } else {
            (match images {
                Some(images) => image_requests.iter().map(|r| {
                    let image=images.image(&r.resource.id)?;
                    Ok(u64::from(image.width)*u64::from(image.height))
                }).collect::<Result<Vec<_>,String>>()?.into_iter().sum::<u64>(),
                None => 0,
            })
                + image_requests.iter().map(|r| (3 * r.resource.byte_length() + 3) / 4).sum::<u64>()
        };
        let mut largest_surfaces = 0;
        let mut largest_plan_pixels = 0;
        for id in nodes.keys() {
            let mut work = ExpandedWork::default();
            self.walk(
                id,
                &nodes,
                &mut BTreeSet::new(),
                1,
                &mut largest_surfaces,
                &mut work,
                [f64::from(width), f64::from(height)],
                step,
                1,
            )?;
            largest_plan_pixels = largest_plan_pixels.max(work.plan_pixels);
        }
        if !nodes.contains_key(self.root.as_str()) {
            return Err("Unknown MV root node".into());
        }
        // Per-role evaluation is sequential; this bounds nested A/B surfaces plus
        // target, image-data and post scratch buffers (64M pixels = 256MiB).
        // Spatial post also owns an upload, two full-size targets, a drawing
        // buffer and a 3-level two-buffer bloom pyramid. Keep the same byte cap.
        // Warped/decorated sprites own a group and a padded tint mask; Gaussian
        // filtering also needs scratch. Padding is at most 3 sigma (15%/side).
        // Textured meshes use uploads, a WebGL drawing surface and compositing
        // scratch; batches and nested scene evaluation are sequential.
        let scratch = if spatial { 12 } else { 5 }
            // Sequential light-leak draws reuse their peak working set. Preserve
            // owns RGBA readback plus saved A8 alpha; expand uses screen scratch.
            // This is a conservative buffer budget, not a Canvas/RSS hard bound.
            + light_leak_scratch
            + if decorated { 5 } else { 0 }
            + if surface { 4 } else { 0 };
        if u64::from(width) * u64::from(height) * (largest_surfaces + scratch)
            + afterimage_scratch + image_scratch + largest_plan_pixels > 67_108_864 {
            return Err("MV recipe exceeds the temporary raster surface budget".into());
        }
        Ok(())
    }
    fn walk<'a>(
        &self,
        id: &str,
        nodes: &BTreeMap<&str, &'a Scene>,
        stack: &mut BTreeSet<String>,
        depth: u64,
        largest: &mut u64,
        work: &mut ExpandedWork,
        dimensions: [f64; 2],
        step: u64,
        live_surfaces: u64,
    ) -> Result<(), String> {
        if depth > 8 || !stack.insert(id.to_string()) {
            return Err("MV graph contains a cycle or exceeds depth 8".into());
        }
        *largest = (*largest).max(live_surfaces);
        let node = nodes
            .get(id)
            .ok_or_else(|| format!("Unknown MV input node: {id}"))?;
        work.drawing += match node {
            Scene::Flame { .. } => 16,
            Scene::Fall { .. } => 16,
            Scene::Thread { .. } => 16,
            Scene::KanjiSlam { .. } => 16,
            Scene::TitleRiff { .. } => 16,
            Scene::Ember { .. } => 16,
            Scene::Converge { .. } => 16,
            Scene::TypeCard { .. } => 16,
            Scene::Afterimage { .. } => 8,
            Scene::Illust { sprites, .. } => 1 + sprites.iter().map(Sprite::work).sum::<u32>(),
            Scene::Transition { style, .. } => style.work(),
            Scene::Panels { panels, .. } => 1 + panels.len() as u32 * 2,
            _ => 1,
        };
        if work.drawing > 256 {
            return Err("MV graph exceeds 256 expanded drawing operations".into());
        }
        // Keep the existing complex-operation budget. Simple glyphs/image cells
        // have a separate finite expanded-DAG budget, including shared inputs.
        let primitive_cost = match node {
            Scene::Flame {settings,..} => {
                work.plan_pixels+=settings.plan_pixels();
                settings.work()
            }
            Scene::Fall {settings,span,..} => {
                work.plan_pixels+=settings.plan_pixels();
                let ticks=u64::from(span.duration_frames).checked_mul(step).ok_or("MV simulation duration overflow")?;
                let cost=settings.sim_work(ticks).ok_or("MV simulation work overflow")?;
                work.simulation=work.simulation.checked_add(cost).ok_or("MV expanded simulation work overflow")?;
                if work.simulation>super::cloth::MAX_SIMULATION_WORK {
                    return Err("MV graph exceeds 80000000 expanded simulation work units".into());
                }
                settings.work()
            }
            Scene::Thread {settings,..} => {
                work.plan_pixels+=settings.plan_pixels();
                settings.work()
            }
            Scene::KanjiSlam {settings,..} => {
                work.plan_pixels+=settings.plan_pixels();
                settings.work()
            }
            Scene::TitleRiff {settings,..} => {
                work.plan_pixels+=settings.plan_pixels();
                settings.work()
            }
            Scene::Ember { settings, .. } => {
                work.plan_pixels += settings.plan_pixels();
                settings.work()
            }
            Scene::Converge { settings, .. } => {
                work.plan_pixels += settings.plan_pixels();
                settings.work()
            }
            Scene::TypeCard { settings, .. } => {
                work.plan_pixels += settings.plan_pixels();
                settings.work()
            }
            Scene::Afterimage { settings, .. } => {
                work.plan_pixels += settings.plan_pixels();
                settings.work()
            }
            Scene::Cloth { settings, span, .. } => {
                let ticks = u64::from(span.duration_frames)
                    .checked_mul(step)
                    .ok_or("MV simulation duration overflow")?;
                let cost = settings
                    .sim_work(ticks)
                    .ok_or("MV simulation work overflow")?;
                work.simulation = work
                    .simulation
                    .checked_add(cost)
                    .ok_or("MV expanded simulation work overflow")?;
                if work.simulation > super::cloth::MAX_SIMULATION_WORK {
                    return Err("MV graph exceeds 80000000 expanded simulation work units".into());
                }
                settings.work()
            }
            Scene::Shatter { settings, .. } => settings.work(),
            Scene::Grid { settings, .. } => settings.work(),
            Scene::HexFloat { settings, .. } => settings.work(dimensions[0], dimensions[1]),
            Scene::AsciiSweep { settings, .. } => settings.work(),
            Scene::ParticleScroll { settings, .. } => settings.work(),
            Scene::GlyphRain { settings, .. } => settings.work(),
            Scene::ParticleReveal { settings, .. } => settings.work(),
            _ => 0,
        };
        work.primitives = work.primitives.saturating_add(primitive_cost);
        if work.primitives > super::catalog::GENERATOR_PRIMITIVES {
            return Err("MV graph exceeds 4096 expanded generator primitives".into());
        }
        // Drawing B retains both the transition output and completed A. Panels
        // retain one output; refs/sequences only remap the child clock.
        let inputs: Vec<(&str, u64)> = match node {
            Scene::Transition { from, to, .. } => vec![(from, 1), (to, 2)],
            Scene::Ref { input, .. } => vec![(input, 0)],
            Scene::Sequence { items } => items.iter().map(|s| (s.input.as_str(), 0)).collect(),
            Scene::Panels { panels, .. } => panels.iter().map(|s| (s.input.as_str(), 1)).collect(),
            _ => vec![],
        };
        for (input, retained) in inputs {
            self.walk(
                input,
                nodes,
                stack,
                depth + 1,
                largest,
                work,
                dimensions,
                step,
                live_surfaces + retained,
            )?;
        }
        stack.remove(id);
        Ok(())
    }
}
