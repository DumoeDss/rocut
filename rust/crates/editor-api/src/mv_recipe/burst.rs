//! Beat montage: all timing, framing and original overlapped sprite strips in Rust.
#[path = "burst_budget.rs"]
mod budget;
#[path = "burst_catalog.rs"]
mod catalog;
#[path = "burst_graphics.rs"]
pub(super) mod graphics;
#[path = "converge_math.rs"]
pub(super) mod math;
#[path = "burst_model.rs"]
mod model;
#[path = "burst_plan.rs"]
mod plan;
#[path = "burst_producer.rs"]
mod producer;
pub(super) use budget::{expanded_work, plan_bytes_bound, scratch_pixels};
pub(super) use catalog::entry as catalog_entry;
pub use model::{Args, Character, Tint, View, Wave};
pub use plan::Plan;
pub(super) use plan::{Sprite, Strip, native};
pub(super) use producer::plan;
pub(super) fn valid(args: &Args, resources: &[crate::programmatic_resources::Resource]) -> bool {
    model::valid(args, resources)
}
pub(super) fn image_ids(args: &Args) -> Vec<&str> {
    args.cuts
        .iter()
        .flat_map(|c| {
            c.bg.as_deref()
                .into_iter()
                .chain(c.character.as_ref().map(|c| c.image.as_str()))
        })
        .collect()
}
pub(super) fn font_requests(
    args: &Args,
    resources: &[crate::programmatic_resources::Resource],
) -> Result<Vec<crate::mv_font_metrics::Request>, String> {
    let Some(id) = &args.hud_font else {
        return Ok(Vec::new());
    };
    let resource = resources
        .iter()
        .find(|r| r.id == *id && r.kind == "font")
        .ok_or("Burst HUD font not declared")?
        .clone();
    Ok(vec![crate::mv_font_metrics::Request {
        resource,
        glyphs: "CUT /0123456789".chars().map(|c| c.to_string()).collect(),
        advances: Vec::new(),
        bounds: Vec::new(),
    }])
}
