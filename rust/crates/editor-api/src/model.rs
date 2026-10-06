use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Debug, Serialize)]
pub struct Issue {
    pub path: String,
    pub message: String,
}
impl Issue {
    pub fn new(path: &str, message: &str) -> Self {
        Self {
            path: path.into(),
            message: message.into(),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub editing: Editing,
    pub duration: u64,
    pub track_kind: String,
    pub asset_kind: Option<String>,
    pub has_motion_text: bool,
    pub has_adjustment: bool,
    pub catalog: Catalog,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Editing {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(rename = "name")]
    pub _name: Option<String>,
    pub params: BTreeMap<String, Value>,
    pub hidden: Option<bool>,
    #[serde(default)]
    pub animations: BTreeMap<String, Value>,
    #[serde(default)]
    pub effects: Vec<Effect>,
    #[serde(default)]
    pub masks: Vec<Mask>,
    pub is_source_audio_enabled: Option<bool>,
    pub definition_id: Option<String>,
    pub sticker_id: Option<String>,
    pub intrinsic_width: Option<f64>,
    pub intrinsic_height: Option<f64>,
    pub effect_type: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Effect {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(rename = "enabled")]
    pub _enabled: bool,
    pub params: BTreeMap<String, Value>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Mask {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub params: BTreeMap<String, Value>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PathPoint {
    pub id: String,
    #[serde(rename = "x")]
    pub _x: f64,
    #[serde(rename = "y")]
    pub _y: f64,
    #[serde(rename = "inX")]
    pub _in_x: f64,
    #[serde(rename = "inY")]
    pub _in_y: f64,
    #[serde(rename = "outX")]
    pub _out_x: f64,
    #[serde(rename = "outY")]
    pub _out_y: f64,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Param {
    pub key: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub display_multiplier: Option<f64>,
    pub keyframable: Option<bool>,
    #[serde(default)]
    pub options: Vec<SelectOption>,
}
#[derive(Clone, Deserialize)]
pub struct SelectOption {
    pub value: String,
}

#[derive(Deserialize)]
pub struct MaskSchema {
    pub params: Vec<Param>,
    pub required: Vec<String>,
}
#[derive(Deserialize)]
pub struct Catalog {
    pub elements: BTreeMap<String, Vec<Param>>,
    pub graphics: BTreeMap<String, Vec<Param>>,
    pub effects: BTreeMap<String, Vec<Param>>,
    pub masks: BTreeMap<String, MaskSchema>,
}
