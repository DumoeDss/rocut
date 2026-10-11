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

#[derive(Clone, Default)]
struct ExpandedWork {
    jz_requests: usize,
    memories_requests: usize,
    night_requests: usize,
    heart_requests: usize,
    road_commands: u64,
    tunnel_commands: u64,
    drawing: u32,
    primitives: u32,
    simulation: u64,
    plan_pixels: u64,
}

impl ExpandedWork {
    fn merge_peak(&mut self, other: &Self) {
        self.jz_requests = self.jz_requests.max(other.jz_requests);
        self.memories_requests = self.memories_requests.max(other.memories_requests);
        self.night_requests = self.night_requests.max(other.night_requests);
        self.heart_requests = self.heart_requests.max(other.heart_requests);
        self.road_commands = self.road_commands.max(other.road_commands);
        self.tunnel_commands = self.tunnel_commands.max(other.tunnel_commands);
        self.drawing = self.drawing.max(other.drawing);
        self.primitives = self.primitives.max(other.primitives);
        self.simulation = self.simulation.max(other.simulation);
        self.plan_pixels = self.plan_pixels.max(other.plan_pixels);
    }
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
        self.raster_reservation(resources, frames, width, height, step, images)
            .map(|_| ())
    }
    /// The same whole-source admission used by validation, exposed to the
    /// native host ledger without reimplementing graph policy in TypeScript.
    pub(super) fn raster_reservation(
        &self,
        resources: &[Resource],
        frames: u32,
        width: u32,
        height: u32,
        step: u64,
        images: Option<&crate::mv_image_dimensions::Context>,
    ) -> Result<u64, String> {
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
                Scene::Jz {
                    settings, span: s, ..
                } => {
                    width == 1920
                        && height == 1080
                        && span(s, frames)
                        && super::jz::valid(settings, resources)
                }
                Scene::PanelsNative {
                    settings,
                    bpm,
                    span: s,
                    ..
                } => {
                    width == 1920
                        && height == 1080
                        && span(s, frames)
                        && range(*bpm, 1.0, 1000.0)
                        && settings.validate().is_ok()
                }
                Scene::Freeze {
                    settings, span: s, ..
                } => {
                    width == 1920
                        && height == 1080
                        && span(s, frames)
                        && settings.validate().is_ok()
                }
                Scene::Melt {
                    settings, span: s, ..
                } => {
                    width == 1920
                        && height == 1080
                        && span(s, frames)
                        && settings.validate().is_ok()
                }
                Scene::Rewind {
                    settings, span: s, ..
                } => {
                    uses_audio = true;
                    width == 1920
                        && height == 1080
                        && span(s, frames)
                        && settings.validate(resources).is_ok()
                }
                Scene::IllustNative {
                    settings,
                    bpm,
                    span: s,
                } => {
                    uses_audio = true;
                    afterimage_scratch = afterimage_scratch
                        .max(super::illust_native::scratch_pixels(settings, images)?);
                    width == 1920
                        && height == 1080
                        && span(s, frames)
                        && range(*bpm, 1.0, 1000.0)
                        && super::illust_native::valid(settings, resources)
                }
                Scene::Burst {
                    settings,
                    bpm,
                    span: s,
                    ..
                } => {
                    uses_audio = true;
                    afterimage_scratch =
                        afterimage_scratch.max(super::burst::scratch_pixels(settings, images)?);
                    width == 1920
                        && height == 1080
                        && span(s, frames)
                        && range(*bpm, 1.0, 1000.0)
                        && super::burst::valid(settings, resources)
                }
                Scene::Night {
                    settings, span: s, ..
                } => {
                    uses_audio |= settings.uses_audio();
                    span(s, frames) && settings.validate(width, height, resources).is_ok()
                }
                Scene::Memories { span: s, .. } => {
                    uses_audio = true;
                    width == 1920
                        && height == 1080
                        && span(s, frames)
                        && super::memories_recipe::valid(
                            &n.scene,
                            resources,
                            (self.song_start_seconds * 120000.0).round() as u64,
                            step,
                        )
                }
                Scene::HeartShatter { span: s, .. }
                | Scene::HeartShatterBurn { span: s, .. }
                | Scene::HeartGather { span: s, .. }
                | Scene::SunBloom { span: s, .. }
                | Scene::SkyShatter { span: s, .. } => {
                    uses_audio = true;
                    width == 1920
                        && height == 1080
                        && span(s, frames)
                        && super::heart_recipe::valid(
                            &n.scene,
                            resources,
                            (self.song_start_seconds * 120000.0).round() as u64,
                            step,
                        )
                }
                Scene::Road {
                    role,
                    settings,
                    span: s,
                } => {
                    uses_audio = true;
                    afterimage_scratch = afterimage_scratch.max(settings.scratch_pixels());
                    width == 1920
                        && height == 1080
                        && *role != Role::Foreground
                        && settings.valid(
                            (self.song_start_seconds * 120000.0).round() as u64,
                            s,
                            step,
                        )
                        && settings.resources_valid(resources)
                        && span(s, frames)
                }
                Scene::Tunnel {
                    settings, span: s, ..
                } => {
                    uses_audio |= settings.uses_audio();
                    settings.valid((self.song_start_seconds * 120000.0).round() as u64, s, step)
                        && settings.resources_valid(resources)
                        && span(s, frames)
                }
                Scene::Flame {
                    settings, span: s, ..
                } => {
                    uses_audio |= settings.uses_audio();
                    afterimage_scratch = afterimage_scratch.max(settings.scratch_pixels(images)?);
                    settings.valid((self.song_start_seconds * 120000.0).round() as u64, s, step)
                        && settings.resources_valid(resources)
                        && span(s, frames)
                }
                Scene::Fall {
                    settings, span: s, ..
                } => {
                    uses_audio |= settings.uses_audio();
                    afterimage_scratch = afterimage_scratch.max(settings.scratch_pixels(images)?);
                    settings.valid((self.song_start_seconds * 120000.0).round() as u64, s, step)
                        && settings.resources_valid(resources)
                        && span(s, frames)
                }
                Scene::Ink {
                    settings, span: s, ..
                } => {
                    uses_audio |= settings.uses_audio();
                    afterimage_scratch = afterimage_scratch.max(settings.scratch_pixels(images)?);
                    settings.valid((self.song_start_seconds * 120000.0).round() as u64, s, step)
                        && settings.resources_valid(resources)
                        && span(s, frames)
                }
                Scene::Thread {
                    settings, span: s, ..
                } => {
                    uses_audio |= settings.uses_audio();
                    afterimage_scratch = afterimage_scratch.max(settings.scratch_pixels(images)?);
                    settings.valid((self.song_start_seconds * 120000.0).round() as u64, s, step)
                        && settings.resources_valid(resources)
                        && span(s, frames)
                }
                Scene::KanjiSlam {
                    settings, span: s, ..
                } => {
                    uses_audio |= settings.uses_audio();
                    afterimage_scratch = afterimage_scratch.max(settings.scratch_pixels(images)?);
                    settings.valid((self.song_start_seconds * 120000.0).round() as u64, s, step)
                        && settings.resources_valid(resources)
                        && span(s, frames)
                }
                Scene::TitleRiff {
                    settings, span: s, ..
                } => {
                    uses_audio |= settings.uses_audio();
                    afterimage_scratch = afterimage_scratch.max(settings.scratch_pixels(images)?);
                    settings.valid((self.song_start_seconds * 120000.0).round() as u64, s, step)
                        && settings.resources_valid(resources)
                        && span(s, frames)
                }
                Scene::Ember {
                    settings, span: s, ..
                } => {
                    uses_audio |= settings.uses_audio();
                    afterimage_scratch = afterimage_scratch.max(settings.scratch_pixels());
                    settings.valid(
                        (self.song_start_seconds * 120_000.0).round() as u64,
                        s,
                        step,
                    ) && settings.resources_valid(resources)
                        && span(s, frames)
                }
                Scene::Converge {
                    settings, span: s, ..
                } => {
                    uses_audio |= settings.uses_audio();
                    afterimage_scratch = afterimage_scratch.max(settings.scratch_pixels());
                    settings.valid(
                        (self.song_start_seconds * 120_000.0).round() as u64,
                        s,
                        step,
                    ) && span(s, frames)
                }
                Scene::TypeCard {
                    settings, span: s, ..
                } => {
                    uses_audio |= settings.uses_audio();
                    afterimage_scratch =
                        afterimage_scratch.max(settings.scratch_pixels(width, height));
                    settings.valid()
                        && settings.resources_valid(resources)
                        && span(s, frames)
                        && u64::from(s.duration_frames).checked_mul(step).is_some()
                }
                Scene::Afterimage {
                    settings, span: s, ..
                } => {
                    afterimage_scratch =
                        afterimage_scratch.max(settings.scratch_pixels(width, height));
                    settings.valid()
                        && settings.resources_valid(resources)
                        && span(s, frames)
                        && u64::from(s.duration_frames).checked_mul(step).is_some()
                }
                Scene::ImageSequence {
                    sequence,
                    origin_source_ticks,
                    rate,
                    view,
                    ..
                } => {
                    resources
                        .iter()
                        .any(|r| r.id == *sequence && r.kind == "imageSequence")
                        && origin_source_ticks.unsigned_abs() <= crate::image_sequence::MAX_SAFE
                        && rate.valid_playback()
                        && camera(view)
                }
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
                Scene::Layers { items } => super::layers::valid(items),
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
        let image_scratch = if image_requests.is_empty() {
            0
        } else {
            (match images {
                Some(images) => image_requests
                    .iter()
                    .map(|r| {
                        let image = images.image(&r.resource.id)?;
                        Ok(u64::from(image.width) * u64::from(image.height))
                    })
                    .collect::<Result<Vec<_>, String>>()?
                    .into_iter()
                    .sum::<u64>(),
                None => 0,
            }) + image_requests
                .iter()
                .map(|r| (3 * r.resource.byte_length() + 3) / 4)
                .sum::<u64>()
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
        let pixels = u64::from(width) * u64::from(height) * (largest_surfaces + scratch)
            + afterimage_scratch
            + image_scratch
            + largest_plan_pixels;
        if pixels > 67_108_864 {
            return Err("MV recipe exceeds the temporary raster surface budget".into());
        }
        Ok(pixels * 4)
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
            Scene::Jz { .. } | Scene::PanelsNative { .. } => 16,
            Scene::Freeze { .. } | Scene::Rewind { .. } | Scene::Melt { .. } => 16,
            Scene::IllustNative { .. }
            | Scene::Burst { .. }
            | Scene::Night { .. }
            | Scene::Memories { .. } => 16,
            Scene::Road { .. } => 16,
            Scene::Tunnel { .. } => 16,
            Scene::Flame { .. } => 16,
            Scene::Fall { .. } => 16,
            Scene::Thread { .. } => 16,
            Scene::Ink { .. } => 16,
            Scene::KanjiSlam { .. } => 16,
            Scene::TitleRiff { .. } => 16,
            Scene::Ember { .. } => 16,
            Scene::Converge { .. } => 16,
            Scene::TypeCard { .. } => 16,
            Scene::Afterimage { .. } => 8,
            Scene::Illust { sprites, .. } => 1 + sprites.iter().map(Sprite::work).sum::<u32>(),
            Scene::Transition { style, .. } => style.work(),
            Scene::Panels { panels, .. } => 1 + panels.len() as u32 * 2,
            Scene::Layers { items } => 1 + items.len() as u32,
            _ => 1,
        };
        if work.drawing > 256 {
            return Err("MV graph exceeds 256 expanded drawing operations".into());
        }
        // Keep the existing complex-operation budget. Simple glyphs/image cells
        // have a separate finite expanded-DAG budget, including shared inputs.
        let primitive_cost = match node {
            Scene::Jz { settings, .. } => {
                work.jz_requests += 1;
                if work.jz_requests > super::jz::MAX_OWNER_SESSIONS {
                    return Err("JIZURA expanded native session capability exceeded".into());
                }
                work.plan_pixels = work
                    .plan_pixels
                    .checked_add(super::jz::plan_bytes_bound(settings) * 3)
                    .ok_or("JIZURA expanded request residency overflow")?;
                super::jz::expanded_work(settings)
            }
            Scene::PanelsNative { settings, .. } => {
                work.plan_pixels = work
                    .plan_pixels
                    .checked_add(settings.plan_bytes_bound()? * 3)
                    .ok_or("PanelsNative expanded plan residency overflow")?;
                u32::try_from(settings.expanded_work()?)
                    .map_err(|_| "PanelsNative expanded work overflow")?
            }
            Scene::Freeze { .. } | Scene::Rewind { .. } | Scene::Melt { .. } => {
                use super::meta_reference::{self as meta, Kind};
                let kind = match node {
                    Scene::Freeze { .. } => Kind::Freeze,
                    Scene::Rewind { .. } => Kind::Rewind,
                    _ => Kind::Melt,
                };
                work.plan_pixels = work
                    .plan_pixels
                    .checked_add(meta::plan_bytes_bound(kind) * 3)
                    .ok_or("Meta expanded plan residency overflow")?;
                match node {
                    Scene::Freeze { settings, .. } => u32::try_from(settings.expanded_work()?)
                        .map_err(|_| "Freeze work overflow")?,
                    Scene::Melt { settings, .. } => u32::try_from(settings.expanded_work()?)
                        .map_err(|_| "Melt work overflow")?,
                    _ => meta::expanded_work(kind) as u32,
                }
            }
            Scene::IllustNative { settings, .. } => {
                work.plan_pixels = work
                    .plan_pixels
                    .checked_add(super::illust_native::plan_bytes_bound(settings) * 3)
                    .ok_or("IllustNative expanded plan residency overflow")?;
                super::illust_native::expanded_work(settings)
            }
            Scene::Burst { settings, .. } => {
                // The leaf enforces this serialization ceiling before publish;
                // charge expanded mapped occurrences and in-flight JSON copies.
                work.plan_pixels = work
                    .plan_pixels
                    .checked_add(super::burst::plan_bytes_bound(settings) * 3)
                    .ok_or("Burst expanded plan residency overflow")?;
                super::burst::expanded_work(settings)
            }
            Scene::Night { .. } => {
                work.night_requests += 1;
                if work.night_requests > 16 {
                    return Err("Night expanded frame exceeds drawing budget".into());
                }
                0
            }
            Scene::Memories { .. } => {
                work.memories_requests += 1;
                if work.memories_requests > super::memories_recipe::MAX_OWNER_SESSIONS {
                    return Err("Memories expanded requests exceed native owner sessions".into());
                }
                0
            }
            Scene::HeartShatter { .. }
            | Scene::HeartShatterBurn { .. }
            | Scene::HeartGather { .. }
            | Scene::SunBloom { .. }
            | Scene::SkyShatter { .. } => {
                work.heart_requests = work
                    .heart_requests
                    .checked_add(1)
                    .ok_or("Heart expanded request count overflow")?;
                if work.heart_requests > crate::mv_heart_owner::MAX_OWNER_SESSIONS {
                    return Err(
                        "Heart expanded requests exceed live owner session capability".into(),
                    );
                }
                0
            }
            Scene::Road { settings, .. } => {
                work.road_commands = work
                    .road_commands
                    .checked_add(16384)
                    .ok_or("Road expanded command work overflow")?;
                if work.road_commands > 16384 {
                    return Err("MV graph exceeds 16384 expanded Road commands".into());
                }
                work.plan_pixels = work
                    .plan_pixels
                    .checked_add(settings.plan_pixels())
                    .ok_or("Road expanded plan bytes overflow")?;
                0
            }
            Scene::Tunnel { .. } => {
                work.tunnel_commands = work
                    .tunnel_commands
                    .checked_add(32768)
                    .ok_or("Tunnel expanded command work overflow")?;
                if work.tunnel_commands > 32768 {
                    return Err("MV graph exceeds 32768 expanded Tunnel commands".into());
                }
                work.plan_pixels += 65536;
                0
            }
            Scene::Flame { settings, .. } => {
                work.plan_pixels += settings.plan_pixels();
                settings.work()
            }
            Scene::Fall { settings, span, .. } => {
                work.plan_pixels += settings.plan_pixels();
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
            Scene::Ink { settings, .. } => {
                work.plan_pixels += settings.plan_pixels();
                settings.work()
            }
            Scene::Thread { settings, .. } => {
                work.plan_pixels += settings.plan_pixels();
                settings.work()
            }
            Scene::KanjiSlam { settings, .. } => {
                work.plan_pixels += settings.plan_pixels();
                settings.work()
            }
            Scene::TitleRiff { settings, .. } => {
                work.plan_pixels += settings.plan_pixels();
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
            Scene::PanelsNative { settings, .. } => {
                let pixels = dimensions[0] as u64 * dimensions[1] as u64;
                let inputs = settings.inputs();
                // Native focus/speed lines sit between background and subject.
                // Both completed role phases remain live until panel replay.
                let retained = 2
                    + inputs.len() as u64 * 2
                    + super::meta_reference::scratch_pixels(super::meta_reference::Kind::Panels)
                        .div_ceil(pixels);
                inputs.into_iter().map(|input| (input, retained)).collect()
            }
            Scene::Freeze { input, .. }
            | Scene::Melt { input, .. }
            | Scene::Rewind { input, .. } => {
                use super::meta_reference::{self as meta, Kind};
                let kind = match node {
                    Scene::Freeze { .. } => Kind::Freeze,
                    Scene::Rewind { .. } => Kind::Rewind,
                    _ => Kind::Melt,
                };
                let pixels = dimensions[0] as u64 * dimensions[1] as u64;
                let retained = 2 + meta::scratch_pixels(kind).div_ceil(pixels);
                if matches!(node, Scene::Rewind { settings, .. } if settings.follow != Some(false))
                {
                    // Every possible local source is checked. Only one selected
                    // shot is live, so alternative residency/work use maxima.
                    let mut candidates = vec![(input.as_str(), retained)];
                    candidates.extend(
                        nodes
                            .iter()
                            .filter(|(key, scene)| {
                                **key != id
                                    && **key != input.as_str()
                                    && !scene.is_reference_wrapper()
                            })
                            .map(|(key, _)| (*key, retained)),
                    );
                    candidates
                } else {
                    vec![(input.as_str(), retained)]
                }
            }
            Scene::Transition { from, to, .. } => vec![(from, 1), (to, 2)],
            Scene::Ref { input, .. } => vec![(input, 0)],
            Scene::Sequence { items } => items.iter().map(|s| (s.input.as_str(), 0)).collect(),
            Scene::Layers { items } => items.iter().map(|s| (s.input.as_str(), 1)).collect(),
            Scene::Panels { panels, .. } => panels.iter().map(|s| (s.input.as_str(), 1)).collect(),
            _ => vec![],
        };
        let alternatives =
            matches!(node, Scene::Rewind { settings, .. } if settings.follow != Some(false));
        let base = work.clone();
        for (input, retained) in inputs {
            let mut branch = if alternatives {
                base.clone()
            } else {
                work.clone()
            };
            self.walk(
                input,
                nodes,
                stack,
                depth + 1,
                largest,
                &mut branch,
                dimensions,
                step,
                live_surfaces + retained,
            )?;
            if alternatives {
                work.merge_peak(&branch);
            } else {
                *work = branch;
            }
        }
        stack.remove(id);
        Ok(())
    }
}
