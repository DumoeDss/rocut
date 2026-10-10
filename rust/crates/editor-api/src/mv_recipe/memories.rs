//! Complete Memories scene owner leaves; shared registry/provider wiring is intentionally external.
#[path = "memories_admission.rs"]
pub mod admission;
#[path = "memories_bake.rs"]
mod bake;
#[path = "memories_budget.rs"]
mod budget;
#[path = "memories_caption.rs"]
mod caption;
#[path = "memories_draw.rs"]
mod draw;
#[path = "memories_field.rs"]
mod field;
#[path = "memories_finish.rs"]
mod finish;
#[path = "memories_grade.rs"]
mod grade;
#[path = "memories_live.rs"]
mod live;
#[path = "memories_math.rs"]
mod math;
#[path = "memories_model.rs"]
pub mod model;
#[path = "memories_motion.rs"]
mod motion;
#[path = "memories_paper.rs"]
mod paper;
#[path = "memories_particles.rs"]
mod particles;
#[path = "memories_plan.rs"]
pub mod plan;
#[path = "memories_producer.rs"]
mod producer;
#[path = "memories_stage.rs"]
pub mod stage;
#[cfg(test)]
#[path = "memories_tests.rs"]
mod tests;
use crate::programmatic_resources::Resource;
use sha2::{Digest, Sha256};
pub struct ImageFact {
    pub resource: Resource,
    pub width: u32,
    pub height: u32,
}
pub struct FontFact {
    pub resource: Resource,
    pub size: f64,
    pub weight: u32,
    pub widths: std::collections::BTreeMap<String, f64>,
}
pub struct NativeFacts {
    pub images: Vec<ImageFact>,
    pub caption: FontFact,
    pub date: FontFact,
}
pub struct Photo {
    index: usize,
    slot: motion::Slot,
    caption: String,
    date: String,
    face: Option<[f64; 2]>,
    hero: bool,
    seed: f64,
    field: field::Field,
    base: Option<plan::Payload>,
    graded: Option<plan::Raster>,
}
pub struct Session {
    args: model::Args,
    resources: Vec<Resource>,
    facts: NativeFacts,
    binding: String,
    photos: Vec<Photo>,
    desk: Option<plan::Payload>,
    stage: stage::State,
}
pub struct Sample<'a> {
    pub song_ticks: u64,
    pub shot_start_ticks: u64,
    pub shot_end_ticks: u64,
    pub beats: &'a [u64],
    pub bpm: f64,
    pub downbeat_index: i32,
    pub resources: &'a [Resource],
}
impl Session {
    /// Only a byte-admitting native render owner may construct these non-Deserialize facts.
    pub fn prepare(
        args: model::Args,
        resources: Vec<Resource>,
        facts: NativeFacts,
        max_bytes: usize,
    ) -> Result<Self, String> {
        let selection = model::select(&args)?;
        let source_bytes = admission::validate(&args, &resources, &facts)?;
        let reserved = source_bytes
            .checked_add(args.photos.len() as u64 * 24 * 1024 * 1024 + 24 * 1024 * 1024)
            .ok_or("Memories preparation overflow")?;
        if reserved > (max_bytes as u64).min(256 * 1024 * 1024) {
            return Err("Memories joint preparation exceeds admission ceiling".into());
        }
        let stage = stage::State::new((max_bytes as u64).min(256 * 1024 * 1024), reserved)?;
        let identity = serde_json::json!({"algorithm":"memories-native-bake-v1","args":args,"resources":resources,"images":facts.images.iter().map(|f|serde_json::json!({"source":f.resource,"width":f.width,"height":f.height})).collect::<Vec<_>>(),"caption":{"resource":facts.caption.resource,"size":facts.caption.size,"weight":facts.caption.weight,"widths":facts.caption.widths},"date":{"resource":facts.date.resource,"size":facts.date.size,"weight":facts.date.weight,"widths":facts.date.widths}});
        let binding = format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(&identity).map_err(|e| e.to_string())?)
        );
        let seed = args.seed.unwrap_or(45) as f64;
        let slots = motion::slots(args.photos.len(), seed);
        let mut photos = Vec::new();
        for (pos, index) in selection.order.into_iter().enumerate() {
            let p = &args.photos[index];
            let with_char = Some(index) == selection.char_in && selection.character.is_some();
            let face = if with_char {
                Some([
                    (20.0 + 1040.0 * 0.665 / 2.0) / 560.0,
                    (20.0 + 650.0 * 0.3 / 2.0) / 431.0,
                ])
            } else {
                None
            };
            let hero = index == selection.hero;
            let ps = seed + index as f64 * 7.0;
            photos.push(Photo {
                index,
                slot: slots[pos],
                caption: p.caption.clone(),
                date: p
                    .date
                    .clone()
                    .unwrap_or_else(|| model::DATES[index % 6].into()),
                face,
                hero,
                seed: ps,
                field: field::build(ps, hero, face),
                base: None,
                graded: None,
            });
        }
        Ok(Self {
            args,
            resources,
            facts,
            binding,
            photos,
            desk: None,
            stage,
        })
    }
    pub fn prepared(&self) -> Result<Vec<(&plan::Raster, &[u8])>, String> {
        let mut out = Vec::new();
        let desk = self.desk.as_ref().ok_or("Memories desk is not prepared")?;
        out.push((&desk.raster, desk.rgba.as_slice()));
        for p in &self.photos {
            let base = p
                .base
                .as_ref()
                .ok_or("Memories photo print is not prepared")?;
            out.push((&base.raster, base.rgba.as_slice()));
        }
        Ok(out)
    }
    pub fn frame(&self, s: &Sample<'_>) -> Result<plan::Frame, String> {
        producer::frame(self, s)
    }
}
