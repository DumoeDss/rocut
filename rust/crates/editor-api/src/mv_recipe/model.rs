pub use super::{
    post_model::Effect,
    transition_model::{DrawCommand, Transition},
};
use serde::{Deserialize, Serialize};

#[cfg(test)]
#[path = "kanji_slam_public_tests.rs"]
mod kanji_slam_public_tests;

pub type Color = [f64; 4];
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Role {
    Background,
    Subject,
    Graphics,
    Foreground,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Ease {
    Linear,
    InOutSine,
    InOutCubic,
    InExpo,
    OutExpo,
    InOutExpo,
    InQuad,
    OutQuad,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Recipe {
    pub version: u32,
    pub root: String,
    pub song_start_seconds: f64,
    pub output_roles: Vec<Role>,
    pub nodes: Vec<Node>,
    #[serde(default)]
    pub audio: Option<super::audio::Binding>,
    #[serde(default)]
    pub post: Vec<Post>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Node {
    pub id: String,
    pub scene: Scene,
}

#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Scene {
    Jz { role: Role, settings: super::jz::Args, span: Span },
    PanelsNative { role: Role, settings: super::meta_reference::Panels, bpm: f64, span: Span },
    Freeze { role: Role, input: String, span: Span, settings: super::meta_reference::Freeze },
    Rewind { role: Role, input: String, span: Span, settings: super::meta_reference::Rewind },
    Melt { role: Role, input: String, span: Span, settings: super::meta_reference::Melt },
    IllustNative { settings: super::illust_native::Args, bpm: f64, span: Span },
    Burst { role: Role, settings: super::burst::Args, bpm: f64, span: Span },
    Night { role: Role, settings: super::night_recipe::Night, span: Span },
    Memories { role: Role, settings: super::memories::model::Args, bpm: f64, span: Span },
    HeartShatter { role: Role, settings: super::heart::HeartShatter, bpm: f64, span: Span },
    HeartShatterBurn { role: Role, settings: super::heart::HeartBurn, bpm: f64, span: Span },
    HeartGather { role: Role, settings: super::heart::HeartGather, bpm: f64, span: Span },
    SunBloom { role: Role, settings: super::heart::SunBloom, bpm: f64, span: Span },
    SkyShatter { role: Role, settings: super::heart::SkyShatter, bpm: f64, span: Span },
    Road { role: Role, settings: super::road_recipe::Road, span: Span },
    Tunnel { role: Role, settings: super::tunnel::Tunnel, span: Span },
    Ink {
        role: Role,
        settings: super::ink::Ink,
        span: Span,
    },
    Flame {
        role: Role,
        settings: super::flame::Flame,
        span: Span,
    },
    Fall {
        role: Role,
        settings: super::fall::Fall,
        span: Span,
    },
    Thread {
        role: Role,
        settings: super::thread::Thread,
        span: Span,
    },
    KanjiSlam {
        role: Role,
        settings: super::kanji_slam::KanjiSlam,
        span: Span,
    },
    TitleRiff {
        role: Role,
        settings: super::title_riff::TitleRiff,
        span: Span,
    },
    Ember {
        role: Role,
        settings: super::ember::Ember,
        span: Span,
    },
    Converge {
        role: Role,
        settings: super::converge::Converge,
        span: Span,
    },
    TypeCard {
        role: Role,
        settings: super::type_card::TypeCard,
        span: Span,
    },
    Afterimage {
        role: Role,
        settings: super::afterimage::Afterimage,
        span: Span,
    },
    ImageSequence {
        sequence: String,
        origin_source_ticks: i64,
        rate: crate::image_sequence::Rate,
        role: Role,
        view: Camera,
    },
    Cloth {
        role: Role,
        settings: super::cloth::Cloth,
        span: Span,
    },
    Shatter {
        role: Role,
        settings: super::shatter::Shatter,
        span: Span,
        easing: Ease,
    },
    Grid {
        role: Role,
        settings: super::grid::Grid,
        span: Span,
        easing: Ease,
    },
    HexFloat {
        role: Role,
        settings: super::hex_float::HexFloat,
        span: Span,
        easing: Ease,
    },
    AsciiSweep {
        role: Role,
        settings: super::ascii_sweep::AsciiSweep,
        span: Span,
        easing: Ease,
    },
    ParticleScroll {
        role: Role,
        settings: super::particle_scroll::ParticleScroll,
        span: Span,
        easing: Ease,
    },
    GlyphRain {
        role: Role,
        settings: super::generator_model::GlyphRain,
    },
    ParticleReveal {
        role: Role,
        settings: super::generator_model::ParticleReveal,
        span: Span,
        easing: Ease,
    },
    Ref {
        input: String,
        time_map: Vec<super::reference::TimePoint>,
    },
    /// Explicit intervals, not an inferred BPM or a Blender image sequence.
    Sequence {
        items: Vec<super::reference::SequenceItem>,
    },
    Layers {
        items: Vec<super::layers::Item>,
    },
    Panels {
        panels: Vec<super::panel_model::Panel>,
        #[serde(default)]
        collapse: Option<super::panel_model::Collapse>,
        #[serde(default)]
        border: Option<super::transition_model::Edge>,
    },
    Solid {
        role: Role,
        color: Color,
    },
    Illust {
        motion: Span,
        easing: Ease,
        #[serde(default)]
        background: Option<Background>,
        #[serde(default)]
        sprites: Vec<Sprite>,
    },
    Transition {
        from: String,
        to: String,
        span: Span,
        easing: Ease,
        style: Transition,
    },
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Span {
    pub start_frame: u32,
    pub duration_frames: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Background {
    pub image: String,
    pub from: Camera,
    pub to: Camera,
    #[serde(default)]
    pub audio: Vec<super::audio::Response<super::audio::CameraTarget>>,
}
#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Camera {
    pub x: f64,
    pub y: f64,
    pub zoom: f64,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Pose {
    pub x: f64,
    pub y: f64,
    pub height: f64,
    pub rotation: f64,
    pub opacity: f64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Sprite {
    pub image: String,
    pub role: Role,
    pub from: Pose,
    pub to: Pose,
    pub anchor: [f64; 2],
    #[serde(default)]
    pub flip: bool,
    /// Drawing sampling is independent of the camera and output frame rate.
    #[serde(default)]
    pub drawing_fps: Option<u32>,
    #[serde(default)]
    pub sway: Option<Oscillation>,
    #[serde(default)]
    pub breathe: Option<Oscillation>,
    #[serde(default)]
    pub enter: Option<super::sprite_model::Entrance>,
    #[serde(default)]
    pub exit: Option<super::sprite_model::Entrance>,
    #[serde(default)]
    pub wave: Option<super::sprite_model::Wave>,
    #[serde(default)]
    pub shadow: Option<super::sprite_model::Underlay>,
    #[serde(default)]
    pub rim: Option<super::sprite_model::Underlay>,
    #[serde(default)]
    pub silhouette: Option<Color>,
    #[serde(default)]
    pub glow: Option<super::sprite_model::Glow>,
    #[serde(default)]
    pub audio: Vec<super::audio::Response<super::audio::SpriteTarget>>,
}
#[derive(Clone, Copy, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Oscillation {
    pub amplitude: f64,
    pub frequency: f64,
    pub phase: f64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Post {
    #[serde(default)]
    pub stage: super::post_model::PostStage,
    #[serde(default)]
    pub roles: Vec<Role>,
    pub effects: Vec<Effect>,
    #[serde(default)]
    pub automation: Vec<super::post_automation::AmountCurve>,
    #[serde(default)]
    pub audio: Vec<super::audio::PostResponse>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub version: u32,
    pub song_seconds: f64,
    pub output_roles: Vec<Role>,
    pub root: PlanNode,
    pub post: Vec<PostPlan>,
}
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PlanNode {
    PanelsNative { role: Role, inputs: Vec<Option<Box<PlanNode>>>, data: super::meta_reference::PanelsPlan },
    JzOwnerRequest { role: Role, #[serde(rename = "nodeId")] node_id: String, request: super::jz::Request },
    Freeze { role: Role, input: Box<PlanNode>, data: super::meta_reference::FreezePlan },
    Rewind { role: Role, input: Option<Box<PlanNode>>, data: super::meta_reference::RewindPlan },
    Melt { role: Role, input: Box<PlanNode>, data: super::meta_reference::MeltPlan },
    IllustNative { data: super::illust_native::Plan },
    Burst { role: Role, data: super::burst::Plan },
    NightOwnerRequest { role: Role, #[serde(rename = "nodeId")] node_id: String, request: super::night_recipe::PreparationRequest },
    MemoriesOwnerRequest { role: Role, #[serde(rename = "nodeId")] node_id: String, request: super::memories_recipe::Request },
    HeartOwnerRequest { role: Role, #[serde(rename = "nodeId")] node_id: String, request: super::heart_recipe::Request },
    Road { role: Role, data: super::road::plan::Plan, #[serde(rename = "nativePost")] native_post: super::road_recipe::NativePost },
    Tunnel { role: Role, data: super::tunnel::Plan, #[serde(rename = "nativePost")] native_post: super::tunnel::NativePost },
    Ink {
        role: Role,
        data: super::ink::Plan,
    },
    Flame {
        role: Role,
        data: super::flame::Plan,
    },
    Fall {
        role: Role,
        data: super::fall::Plan,
    },
    Thread {
        role: Role,
        data: super::thread::Plan,
    },
    KanjiSlam {
        role: Role,
        data: super::kanji_slam::Plan,
    },
    TitleRiff {
        role: Role,
        data: super::title_riff::Plan,
    },
    Ember {
        role: Role,
        data: super::ember::Plan,
    },
    Converge {
        role: Role,
        data: super::converge::Plan,
    },
    TypeCard {
        role: Role,
        data: super::type_card::Plan,
    },
    Afterimage {
        role: Role,
        data: super::afterimage::Plan,
    },
    ImageSequence {
        #[serde(rename = "imageKey")]
        image_key: String,
        role: Role,
        view: Camera,
    },
    Cloth {
        role: Role,
        data: super::mesh_model::MeshImagePlan,
    },
    Shatter {
        role: Role,
        data: super::mesh_model::MeshImagePlan,
    },
    Grid {
        role: Role,
        data: super::mesh_model::MeshImagePlan,
    },
    HexFloat {
        role: Role,
        data: super::mesh_model::MeshImagePlan,
    },
    AsciiSweep {
        role: Role,
        data: super::ascii_sweep::AsciiSweepPlan,
    },
    ParticleScroll {
        role: Role,
        data: super::particle_scroll::ParticleScrollPlan,
    },
    GlyphRain {
        role: Role,
        data: super::generator_model::GlyphRainPlan,
    },
    ParticleReveal {
        role: Role,
        data: super::generator_model::ParticleRevealPlan,
    },
    Empty,
    Ref {
        input: Box<PlanNode>,
        #[serde(rename = "sampledFrame")]
        sampled_frame: u64,
    },
    Panels {
        panels: Vec<super::panel_model::PanelPlan>,
    },
    Layers {
        items: Vec<super::layers::ItemPlan>,
    },
    Solid {
        role: Role,
        color: Color,
    },
    Illust {
        background: Option<BackgroundPlan>,
        sprites: Vec<SpritePlan>,
    },
    Transition {
        from: Box<PlanNode>,
        to: Box<PlanNode>,
        progress: f64,
        style: Transition,
        commands: Vec<DrawCommand>,
    },
}
#[derive(Serialize)]
pub struct BackgroundPlan {
    pub image: String,
    pub camera: Camera,
}
#[derive(Serialize)]
pub struct SpritePlan {
    pub image: String,
    pub role: Role,
    pub pose: Pose,
    pub anchor: [f64; 2],
    pub flip: bool,
    pub slices: Option<Vec<super::sprite_model::Slice>>,
    pub shadow: Option<super::sprite_model::Underlay>,
    pub rim: Option<super::sprite_model::Underlay>,
    pub silhouette: Option<Color>,
    pub glow: Option<super::sprite_model::Glow>,
}
#[derive(Serialize)]
pub struct PostPlan {
    pub stage: super::post_model::PostStage,
    pub roles: Vec<Role>,
    pub effects: Vec<EffectPlan>,
}
#[derive(Serialize)]
pub struct EffectPlan {
    pub effect: Effect,
    pub seed: u32,
    #[serde(rename = "lightLeak", skip_serializing_if = "Option::is_none")]
    pub light_leak: Option<super::light_leak::Plan>,
}
