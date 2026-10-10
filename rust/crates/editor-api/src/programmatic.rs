//! The authoritative source limits and integer, half-open frame mapping.
use crate::model::Issue;
use bridge::export;
use serde::{Deserialize, Serialize};

#[cfg(test)]
#[path = "programmatic_font_metrics_tests.rs"]
mod font_metrics_tests;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Source {
    version: u32,
    runtime: String,
    code: String,
    #[serde(default, deserialize_with = "deserialize_document_id")]
    document_id: Option<String>,
    width: u32,
    height: u32,
    frame_rate: Rate,
    duration_frames: u32,
    seed: u32,
    #[serde(default)]
    resources: Vec<crate::programmatic_resources::Resource>,
    #[serde(
        default,
        deserialize_with = "crate::programmatic_build::deserialize_build"
    )]
    build: Option<crate::programmatic_build::Build>,
    #[serde(
        default,
        deserialize_with = "crate::programmatic_audio::deserialize_audio"
    )]
    audio: Option<crate::programmatic_audio::AudioSettings>,
    #[serde(default, deserialize_with = "crate::mv_recipe::deserialize_recipe")]
    recipe: Option<crate::mv_recipe::Recipe>,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Rate {
    numerator: u32,
    denominator: u32,
}

fn deserialize_document_id<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<String>, D::Error> {
    String::deserialize(d).map(Some)
}

impl Source {
    pub(crate) fn native_audio(
        &self,
    ) -> Option<(&crate::programmatic_audio::AudioSettings, u32, u32, u32)> {
        self.audio.as_ref().map(|a| {
            (
                a,
                self.frame_rate.numerator,
                self.frame_rate.denominator,
                self.duration_frames,
            )
        })
    }
    fn ticks_per_frame(&self) -> Option<u64> {
        let ticks = 120_000u64 * u64::from(self.frame_rate.denominator);
        let num = u64::from(self.frame_rate.numerator);
        (ticks > 0 && num > 0 && ticks % num == 0).then(|| ticks / num)
    }
    pub fn validate(&self) -> Vec<Issue> {
        let mut issues = Vec::new();
        for (valid, message) in [
            (
                self.version == 1
                    && matches!(self.runtime.as_str(), "canvas-worker" | "html-document"),
                "Unsupported source version/runtime",
            ),
            (
                if self.recipe.is_some() {
                    self.runtime == "canvas-worker"
                        && self.code.is_empty()
                        && self.document_id.is_none()
                        && self.build.is_none()
                } else {
                    match &self.document_id {
                        Some(id) => {
                            self.runtime == "html-document"
                                && self.code.is_empty()
                                && self
                                    .resources
                                    .iter()
                                    .any(|r| r.id == *id && r.kind == "document")
                        }
                        None => !self.code.trim().is_empty() && self.code.len() <= 262_144,
                    }
                },
                "Use code, a declared HTML documentId, or an exclusive Canvas recipe",
            ),
            (
                self.runtime == "html-document"
                    || !self.resources.iter().any(|r| r.kind == "document"),
                "Document attachments require the html-document runtime",
            ),
            (
                self.width > 0 && self.height > 0 && self.width <= 4096 && self.height <= 4096,
                "Source dimensions must be 1..4096",
            ),
            (
                self.ticks_per_frame().is_some()
                    && self.frame_rate.numerator <= 120_000
                    && self.frame_rate.denominator <= 1001,
                "Frame rate must have integral ticks/frame and bounded numerator/denominator",
            ),
            (
                self.duration_frames > 0 && self.duration_frames <= 1_000_000,
                "Source duration must be 1..1000000 frames",
            ),
        ] {
            if !valid {
                issues.push(Issue::new("editing.programmatic", message));
            }
        }
        issues.extend(crate::programmatic_resources::validate(&self.resources));
        if let Some(audio) = &self.audio {
            if !audio.valid()
                || self.runtime != "html-document"
                || !self
                    .build
                    .as_ref()
                    .is_some_and(|b| b.supports_native_audio())
            {
                issues.push(Issue::new("editing.programmatic.audio",
                    "Native audio requires a compiled Remotion/HyperFrames source and valid version/mode/gain"));
            }
            if audio.profile().is_some()
                && !self
                    .build
                    .as_ref()
                    .is_some_and(|b| b.supports_hyperframes_graph_audio())
            {
                issues.push(Issue::new("editing.programmatic.audio",
                    "The hyperframes-graph-v1 audio profile requires a compiled HyperFrames 0.8.139 source"));
            }
        }
        if self.runtime != "html-document" && self.resources.iter().any(|r| r.kind == "video") {
            issues.push(Issue::new(
                "editing.programmatic.resources",
                "Video attachments currently require the html-document runtime",
            ));
        }
        if self.recipe.is_none() && self.resources.iter().any(|r| r.kind == "analysis") {
            issues.push(Issue::new(
                "editing.programmatic.resources",
                "Analysis attachments currently require an MV recipe",
            ));
        }
        let sequence_count = self
            .resources
            .iter()
            .filter(|r| r.kind == "imageSequence")
            .count();
        if (self.recipe.is_none() && sequence_count > 0)
            || sequence_count > crate::image_sequence::LIMITS.max_manifests
        {
            issues.push(Issue::new(
                "editing.programmatic.resources",
                "At most 8 imageSequence resources are allowed, exclusively in an MV recipe",
            ));
        }
        if let Some(recipe) = &self.recipe {
            issues.extend(recipe.validate(
                &self.resources,
                self.duration_frames,
                self.width,
                self.height,
                self.ticks_per_frame().unwrap_or(0),
            ));
        }
        if self.resources.iter().any(|r| r.kind == "source") {
            issues.push(Issue::new(
                "editing.programmatic.resources",
                "Source archives belong in build inputs, not render resources",
            ));
        }
        if let Some(build) = &self.build {
            if self.runtime != "html-document" || self.document_id.is_none() {
                issues.push(Issue::new(
                    "editing.programmatic.build",
                    "Compiled builds require a document-backed HTML source",
                ));
            }
            issues.extend(build.validate());
        }
        issues
    }
    pub fn contains_clip(&self, trim_start: u64, duration: u64) -> bool {
        self.ticks_per_frame().is_some_and(|step| {
            match (
                trim_start.checked_add(duration),
                step.checked_mul(u64::from(self.duration_frames)),
            ) {
                (Some(end), Some(limit)) => end <= limit,
                _ => false,
            }
        })
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FrameRequest {
    source: Source,
    clip_start: u64,
    clip_duration: u64,
    trim_start: u64,
    timeline_time: u64,
    #[serde(default)]
    defer_recipe: bool,
    #[serde(default)]
    analysis: Option<crate::mv_audio::Data>,
    #[serde(default, deserialize_with = "deserialize_sequence_manifests")]
    sequence_manifests: Option<Vec<crate::image_sequence::ManifestInput>>,
    #[serde(default, deserialize_with = "deserialize_font_metrics")]
    font_metrics: Option<Vec<crate::mv_font_metrics::Measurement>>,
    #[serde(default, deserialize_with="deserialize_tunnel_font_measurements")]
    tunnel_font_measurements: Option<Vec<crate::mv_recipe::tunnel_context::Measured>>,
    #[serde(default, deserialize_with = "deserialize_image_dimensions")]
    image_dimensions: Option<Vec<crate::mv_image_dimensions::Measurement>>,
}

fn deserialize_image_dimensions<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<Vec<crate::mv_image_dimensions::Measurement>>, D::Error> {
    Vec::deserialize(d).map(Some)
}

fn deserialize_font_metrics<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<Vec<crate::mv_font_metrics::Measurement>>, D::Error> {
    Vec::deserialize(d).map(Some)
}
fn deserialize_tunnel_font_measurements<'de,D:serde::Deserializer<'de>>(d:D)->Result<Option<Vec<crate::mv_recipe::tunnel_context::Measured>>,D::Error> {
    Vec::deserialize(d).map(Some)
}

fn deserialize_sequence_manifests<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<Vec<crate::image_sequence::ManifestInput>>, D::Error> {
    Vec::deserialize(d).map(Some)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Frame {
    index: u64,
    time: f64,
    timeline_time: u64,
    source_time: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    sample_time: Option<u64>,
    frame_rate: Rate,
    duration_frames: u32,
    seed: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    recipe_plan: Option<crate::mv_recipe::Plan>,
    #[serde(skip_serializing_if = "Option::is_none")]
    resource_limits: Option<crate::programmatic_resources::DecodeLimits>,
    #[serde(skip_serializing_if = "Option::is_none")]
    video_limits: Option<crate::programmatic_resources::VideoLimits>,
    #[serde(skip_serializing_if = "Option::is_none")]
    sequence_images: Option<Vec<crate::image_sequence::SequenceImage>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    sequence_limits: Option<crate::image_sequence::FrameLimits>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    font_metric_requests: Vec<crate::mv_font_metrics::Request>,
    #[serde(skip_serializing_if="Vec::is_empty")]
    tunnel_font_byte_requests: Vec<crate::programmatic_resources::Resource>,
    #[serde(skip_serializing_if="Vec::is_empty")]
    tunnel_font_metric_requests: Vec<crate::mv_recipe::tunnel_context::Request>,
    #[serde(skip_serializing_if="Vec::is_empty")]
    tunnel_font_stacks: Vec<crate::mv_recipe::tunnel_context::BoundStack>,
    #[serde(skip_serializing_if="Option::is_none")]
    tunnel_font_limits: Option<crate::programmatic_tunnel_fonts::Limits>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    image_dimension_requests: Vec<crate::mv_image_dimensions::Request>,
    #[serde(skip_serializing_if = "Option::is_none")]
    image_decode_limits: Option<crate::image_sequence::FrameLimits>,
}

#[export]
pub fn resolve_programmatic_frame_json(input: String) -> String {
    resolve_programmatic_frame(input,None)
}
/// Native binary boundary; never accepts authored admission/descriptors.
pub fn resolve_programmatic_frame_tunnel_bytes(input:String,layout:String,bytes:&[u8])->String {
    if let Err(error) = crate::validate_tunnel_frame_transport_lengths(input.len(), layout.len(), bytes.len()) {
        return serde_json::json!({"error":error}).to_string();
    }
    resolve_programmatic_frame(input,Some((&layout,bytes)))
}
fn resolve_programmatic_frame(input:String,packet:Option<(&str,&[u8])>)->String {
    let result = (|| -> Result<Option<Frame>, String> {
        let r: FrameRequest = serde_json::from_str(&input).map_err(|e| e.to_string())?;
        let issues = r.source.validate();
        if let Some(issue) = issues.first() {
            return Err(issue.message.clone());
        }
        if [r.clip_start, r.clip_duration, r.trim_start, r.timeline_time]
            .iter()
            .any(|v| *v > 9_007_199_254_740_991)
        {
            return Err("Times must be safe integer ticks".into());
        }
        if !r.source.contains_clip(r.trim_start, r.clip_duration) {
            return Err("Clip exceeds programmatic source duration".into());
        }
        let Some(local) = r.timeline_time.checked_sub(r.clip_start) else {
            return Ok(None);
        };
        if local >= r.clip_duration {
            return Ok(None);
        }
        let step = r.source.ticks_per_frame().expect("validated rate");
        if r.analysis.is_some() && r.source.recipe.is_none() {
            return Err("Unexpected analysis without an MV recipe".into());
        }
        let index = (r.trim_start + local) / step;
        let source_time = index * step;
        if r.defer_recipe && r.analysis.is_some() {
            return Err("Cannot defer a supplied audio analysis".into());
        }
        if r.defer_recipe && r.sequence_manifests.is_some() {
            return Err("Cannot defer supplied image sequence manifests".into());
        }
        if r.sequence_manifests.is_some() && r.source.recipe.is_none() {
            return Err("Unexpected image sequence manifests without an MV recipe".into());
        }
        if r.font_metrics.is_some() && (r.defer_recipe || r.source.recipe.is_none()) {
            return Err("Font measurements require a nondeferred MV recipe".into());
        }
        if r.tunnel_font_measurements.is_some() && (r.defer_recipe || r.source.recipe.is_none() || packet.is_none()) {
            return Err("Tunnel measurements require native font bytes and a nondeferred recipe".into());
        }
        let requested_tunnel_fonts=r.source.recipe.as_ref().map(|recipe|recipe.tunnel_font_byte_requests(&r.source.resources)).transpose()?.unwrap_or_default();
        let tunnel_font_limits=(!requested_tunnel_fonts.is_empty()).then(crate::programmatic_tunnel_fonts::limits);
        if r.tunnel_font_measurements.is_some() && requested_tunnel_fonts.is_empty() { return Err("Unexpected Tunnel measurements without a Tunnel scene".into()); }
        let admitted=if let Some((layout,bytes))=packet {
            let fonts=crate::programmatic_tunnel_fonts::packet(layout,bytes,&requested_tunnel_fonts)?;
            Some(crate::mv_recipe::tunnel_context::Admitted::new(r.source.recipe.as_ref().ok_or("Tunnel byte packet requires a recipe")?,&r.source.resources,&fonts)?)
        } else {None};
        let tunnel_font_metric_requests=admitted.as_ref().map(|a|a.requests()).unwrap_or_default();
        let tunnel_fonts=if let Some(measured)=&r.tunnel_font_measurements {
            Some(admitted.as_ref().ok_or("Tunnel missing byte admission")?.bind(measured)?)
        } else {None};
        let tunnel_font_stacks=admitted.as_ref().map(|a|a.stacks()).unwrap_or_default();
        if r.image_dimensions.is_some() && (r.defer_recipe || r.source.recipe.is_none()) {
            return Err("Image dimensions require a nondeferred MV recipe".into());
        }
        let font_metric_requests = r
            .source
            .recipe
            .as_ref()
            .map(|recipe| {
                if r.defer_recipe && r.analysis.is_none() && recipe.audio.is_some() {
                    recipe.font_metric_requests(&r.source.resources)
                } else {
                    recipe.sampled_font_metric_requests(index, step, r.source.seed,
                        r.source.width, r.source.height, r.analysis.as_ref(), &r.source.resources)
                }
            })
            .transpose()?
            .unwrap_or_default();
        let image_dimension_requests = r.source.recipe.as_ref()
            .map(|recipe| recipe.image_dimension_requests(&r.source.resources))
            .transpose()?.unwrap_or_default();
        let defer_recipe = r.defer_recipe
            || (!requested_tunnel_fonts.is_empty() && tunnel_fonts.is_none())
            || (!font_metric_requests.is_empty() && r.font_metrics.is_none())
            || (!image_dimension_requests.is_empty() && r.image_dimensions.is_none());
        let images = r.image_dimensions.as_ref()
            .map(|measured| crate::mv_image_dimensions::Context::new(&image_dimension_requests, measured))
            .transpose()?;
        if let (Some(recipe), Some(images)) = (&r.source.recipe, images.as_ref()) {
            recipe.check_with_images(&r.source.resources, r.source.duration_frames,
                r.source.width, r.source.height, step, Some(images))?;
        }
        let fonts = r
            .font_metrics
            .as_ref()
            .map(|measured| crate::mv_font_metrics::Context::new(&font_metric_requests, measured))
            .transpose()?;
        let has_sequences = r
            .source
            .resources
            .iter()
            .any(|resource| resource.kind == "imageSequence");
        let sequences = if defer_recipe {
            None
        } else {
            Some(crate::image_sequence::Context::new(
                &r.source.resources,
                r.sequence_manifests.as_deref().unwrap_or(&[]),
            )?)
        };
        let sample_time = r
            .trim_start
            .checked_add(local)
            .ok_or("Image sequence source time overflow")?;
        let recipe_plan = if defer_recipe {
            None
        } else {
            r.source
                .recipe
                .as_ref()
                .map(|recipe| {
                    recipe.resolve_with_tunnel_resources(
                        index,
                        step,
                        r.source.seed,
                        r.source.width,
                        r.source.height,
                        r.analysis.as_ref(),
                        &r.source.resources,
                        sample_time,
                        sequences.as_ref(),
                        fonts.as_ref(),
                        images.as_ref(),
                        tunnel_fonts.as_ref(),
                    )
                })
                .transpose()?
        };
        Ok(Some(Frame {
            index,
            time: source_time as f64 / 120_000.0,
            timeline_time: r.timeline_time,
            source_time,
            sample_time: (has_sequences || !font_metric_requests.is_empty()
                || !image_dimension_requests.is_empty() || !requested_tunnel_fonts.is_empty()
                || r.source.recipe.as_ref().is_some_and(|recipe| recipe.audio.is_some()))
                .then_some(sample_time),
            frame_rate: r.source.frame_rate,
            duration_frames: r.source.duration_frames,
            seed: r.source.seed,
            font_metric_requests,
            tunnel_font_byte_requests: if packet.is_none(){requested_tunnel_fonts}else{Vec::new()},
            tunnel_font_metric_requests: if tunnel_fonts.is_none(){tunnel_font_metric_requests}else{Vec::new()},
            tunnel_font_stacks,
            tunnel_font_limits,
            image_dimension_requests,
            image_decode_limits: r.source.resources.iter()
                .any(|resource| matches!(resource.kind.as_str(), "image" | "imageSequence"))
                .then(crate::image_sequence::frame_limits),
            recipe_plan,
            sequence_images: if has_sequences {
                sequences.map(|context| context.into_images())
            } else {
                None
            },
            sequence_limits: has_sequences.then(crate::image_sequence::frame_limits),
            video_limits: crate::programmatic_resources::video_limits(
                r.source.runtime == "html-document",
            ),
            resource_limits: crate::programmatic_resources::decode_limits(
                &r.source.resources,
                r.source
                    .build
                    .as_ref()
                    .is_some_and(|build| build.is_three()),
            ),
        }))
    })();
    match result {
        Ok(frame) => serde_json::json!({"frame":frame}).to_string(),
        Err(error) => serde_json::json!({"error":error}).to_string(),
    }
}
