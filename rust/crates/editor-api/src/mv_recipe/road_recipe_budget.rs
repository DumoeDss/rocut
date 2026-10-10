//! Whole expanded native frame admission. The frozen leaf budget includes
//! source/font/image data and its own JSON; remove those before charging each
//! complete source/decoded set and the complete expanded plan once here.
use super::super::model::{Plan, PlanNode};
use crate::{mv_image_dimensions::Context, programmatic_resources::Resource};
const SURFACE_BYTES: u64 = 1920 * 1080 * 8;
const LIMIT: u64 = 256 * 1024 * 1024;
fn serialized_bytes(value: &impl serde::Serialize) -> Result<u64, String> {
    struct Counter(u64);
    impl std::io::Write for Counter {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0 = self
                .0
                .checked_add(bytes.len() as u64)
                .filter(|n| *n <= 16 * 1024 * 1024)
                .ok_or_else(|| {
                    std::io::Error::other("Road expanded native frame exceeds16MiB transport")
                })?;
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let mut counter = Counter(0);
    serde_json::to_writer(&mut counter, value).map_err(|e| e.to_string())?;
    Ok(counter.0)
}
fn add(a: u64, b: u64) -> Result<u64, String> {
    a.checked_add(b)
        .ok_or_else(|| "Road graph residency overflow".into())
}
fn visit(
    node: &PlanNode,
    retained: u64,
    source: u64,
    images: Option<&Context>,
    peak: &mut u64,
) -> Result<(), String> {
    match node {
        PlanNode::Road {
            data, native_post, ..
        } => {
            // Frozen frame() measures its plan while rasterBudgetBytes is zero.
            let json =
                serialized_bytes(data)? - data.raster_budget_bytes.to_string().len() as u64 + 1;
            let mut character = 0;
            // Only run samples admitted art. Its descriptor is already in the
            // complete resource set; derive which decoded bytes the leaf paid.
            for command in &data.commands {
                if let super::super::road::plan::Command::Native {
                    action:
                        super::super::road::plan::Action::Image {
                            source,
                            source_kind,
                            ..
                        },
                    ..
                } = command
                {
                    if *source_kind == "asset" {
                        let dimensions = images
                            .ok_or("Road graph missing native image facts")?
                            .image(source)?;
                        character = u64::from(dimensions.width) * u64::from(dimensions.height) * 8;
                        break;
                    }
                }
            }
            let base = data
                .raster_budget_bytes
                .checked_sub(source)
                .and_then(|n| n.checked_sub(character))
                .and_then(|n| n.checked_sub(json * 12))
                .ok_or("Road leaf budget decomposition mismatch")?;
            let gl = native_post.plan.allocation_bytes;
            // The GL receipt owns its GPU atlas, not the native Canvas ramp
            // that supplies it. Admit that separate decoded raster as well.
            let ramp = if native_post.dawn.is_some() {
                256 * 16 * 8
            } else {
                0
            };
            *peak = (*peak).max(add(add(add(base, gl)?, ramp)?, retained * SURFACE_BYTES)?);
        }
        PlanNode::Ref { input, .. } => visit(input, retained, source, images, peak)?,
        PlanNode::Layers { items } => {
            for item in items { visit(&item.input, retained + 1, source, images, peak)?; }
        }
        PlanNode::Freeze { input, data, .. } => visit(input, retained + 2 + data.scratch_pixels.div_ceil(1920 * 1080), source, images, peak)?,
        PlanNode::Melt { input, data, .. } => visit(input, retained + 2 + data.scratch_pixels.div_ceil(1920 * 1080), source, images, peak)?,
        PlanNode::Rewind { input, data, .. } => {
            if let Some(input) = input { visit(input, retained + 2 + data.scratch_pixels.div_ceil(1920 * 1080), source, images, peak)?; }
        }
        PlanNode::Panels { panels } => {
            for panel in panels {
                visit(&panel.input, retained + 1, source, images, peak)?;
            }
        }
        PlanNode::PanelsNative { inputs, data, .. } => {
            let retained = retained + 2 + inputs.len() as u64 * 2 + data.scratch_pixels.div_ceil(1920 * 1080);
            for input in inputs.iter().flatten() { visit(input, retained, source, images, peak)?; }
        }
        PlanNode::Transition { from, to, .. } => {
            visit(from, retained + 1, source, images, peak)?;
            visit(to, retained + 2, source, images, peak)?;
        }
        _ => {}
    }
    Ok(())
}
pub(in crate::mv_recipe) fn admit_plan(
    plan: &Plan,
    resources: &[Resource],
    images: Option<&Context>,
) -> Result<(), String> {
    let source = resources
        .iter()
        .try_fold(0, |n, r| add(n, r.byte_length()))?;
    let mut peak = 0;
    visit(&plan.root, 1, source, images, &mut peak)?;
    if peak == 0 {
        return Ok(());
    }
    let mut total = add(
        peak,
        source.checked_mul(3).ok_or("Road source copies overflow")?,
    )?;
    for resource in resources.iter().filter(|r| r.kind == "image") {
        let d = images
            .ok_or("Road complete source decoded facts missing")?
            .image(&resource.id)?;
        total = add(total, u64::from(d.width) * u64::from(d.height) * 8)?;
    }
    // Plan generation already obeys the frozen command/leaf serialization cap.
    // Charge actual expanded transport, including native post and audio ticks.
    let bytes = serialized_bytes(plan)?;
    total = add(total, bytes * 12)?;
    if total > LIMIT {
        return Err("Road complete source/graph/native plan/GL frame exceeds256MiB".into());
    }
    Ok(())
}
