//! Browser-fact DTO matching hyperframes-audio-graph-types.ts. These types do
//! not reinterpret authored timing or substitute author IDs for instance IDs.
use super::fader_model::ResolvedAuthorGain;
use super::model::NativeClip;
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Snapshot {
    pub version: u32,
    pub native_version: String,
    pub time: f64,
    pub tracks: Vec<Track>,
    pub buses: Vec<Bus>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Track {
    pub instance_id: String,
    pub author_id: Option<String>,
    pub resource_id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub authored_muted: bool,
    pub ancestor_hidden: bool,
    pub observed_at: f64,
    pub native: NativeClip,
    #[serde(default)]
    pub resolved_author_gain: ResolvedAuthorGain,
    pub attributes: TrackAttributes,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct TrackAttributes {
    pub group_render_id: Option<String>,
    pub group_author_id: Option<String>,
    pub fx_chain: Option<String>,
    pub automation: Option<String>,
    pub muted: bool,
    pub has_audio: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Bus {
    pub instance_id: String,
    pub author_id: Option<String>,
    pub hidden: bool,
    pub attributes: BusAttributes,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct BusAttributes {
    pub volume: Option<String>,
    pub fx_chain: Option<String>,
    pub automation: Option<String>,
}
