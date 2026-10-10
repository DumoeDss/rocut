// Private lexical leaf of the transient owner capability.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    pub owner_id: u32,
    pub session_id: u32,
    pub binding: heart::Binding,
    pub background: Option<BackgroundBinding>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub character: Option<BackgroundBinding>,
    pub images_manifest_sha256: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Image {
    pub index: u32,
    pub byte_length: u64,
    pub image: heart::PreparedImage,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub identity: Identity,
    pub images: Vec<Image>,
    pub reserved_bytes: u64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Frame {
    pub identity: Identity,
    pub plan: heart::Plan,
}
#[derive(Deserialize)]
#[serde(
    tag = "kind",
    content = "settings",
    rename_all = "camelCase",
    deny_unknown_fields
)]
enum Scene {
    HeartShatter(heart::HeartShatter),
    HeartBurn(heart::HeartBurn),
    HeartGather(heart::HeartGather),
    SunBloom(heart::SunBloom),
    SkyShatter(heart::SkyShatter),
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FrameInput {
    scene: Scene,
    shot_start_ticks: u64,
    shot_end_ticks: u64,
    song_ticks: u64,
    beats: Vec<u64>,
    bpm: f64,
}
