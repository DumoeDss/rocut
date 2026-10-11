use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::BlendMode;
pub use editor_api::NativeTransitionStyle;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameDescriptor {
    pub width: u32,
    pub height: u32,
    pub clear: CanvasClearDescriptor,
    pub items: Vec<FrameItemDescriptor>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasClearDescriptor {
    pub color: [f32; 4],
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum FrameItemDescriptor {
    Layer(LayerDescriptor),
    /// An isolated transparent composition; effects never read its parent backdrop.
    Group(IsolatedGroupDescriptor),
    /// Crossfade complete isolated scene pictures over a shared parent backdrop.
    /// Separate from legacy layer-list transitions, whose wire stays unchanged.
    SceneTransition(Box<SceneTransitionDescriptor>),
    Transition {
        outgoing: Vec<LayerDescriptor>,
        incoming: Vec<LayerDescriptor>,
        progress: f32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        style: Option<NativeTransitionStyle>,
    },
    SceneEffect {
        #[serde(rename = "effectPassGroups")]
        effect_pass_groups: Vec<Vec<EffectPassDescriptor>>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IsolatedGroupDescriptor {
    pub items: Vec<FrameItemDescriptor>,
    pub effect_pass_groups: Vec<Vec<EffectPassDescriptor>>,
    /// Applied once after the entire group's post chain, not to each child.
    pub opacity: f32,
    pub blend_mode: BlendMode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SceneTransitionDescriptor {
    pub outgoing: IsolatedGroupDescriptor,
    pub incoming: IsolatedGroupDescriptor,
    pub progress: f32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<NativeTransitionStyle>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerDescriptor {
    pub texture_id: String,
    pub transform: QuadTransformDescriptor,
    pub opacity: f32,
    pub blend_mode: BlendMode,
    #[serde(default)]
    pub effect_pass_groups: Vec<Vec<EffectPassDescriptor>>,
    pub mask: Option<LayerMaskDescriptor>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuadTransformDescriptor {
    pub center_x: f32,
    pub center_y: f32,
    pub width: f32,
    pub height: f32,
    pub rotation_degrees: f32,
    pub flip_x: bool,
    pub flip_y: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerMaskDescriptor {
    pub texture_id: String,
    pub feather: f32,
    pub inverted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectPassDescriptor {
    pub shader: String,
    pub uniforms: HashMap<String, EffectUniformValueDescriptor>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum EffectUniformValueDescriptor {
    Number(f32),
    Vector(Vec<f32>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasTextureDescriptor {
    pub id: String,
    pub width: u32,
    pub height: u32,
}
