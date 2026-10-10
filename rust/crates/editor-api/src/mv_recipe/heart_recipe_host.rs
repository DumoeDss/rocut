//! Native transport admission, not authored settings. All leases share the
//! remaining budget after the complete outer graph/resources/post reservation.
use super::super::model::{Plan, PlanNode, Recipe};
use crate::{mv_image_dimensions, programmatic_resources::Resource};
use serde::Serialize;
#[cfg(test)]
#[path = "heart_recipe_host_tests.rs"]
mod tests;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reservation {
    pub recipe_reservation_bytes: u64,
    pub session_ceiling_bytes: u64,
    pub max_live_sessions: usize,
    pub raster_byte_limit: u64,
}
fn add(a: u64, b: u64) -> Result<u64, String> {
    a.checked_add(b)
        .ok_or_else(|| "Heart native host residency overflow".into())
}
#[derive(Default)]
struct Requests { heart: usize, memories: usize, night: usize, jz: usize, jz_peak: u64 }
impl Requests {
    fn total(&self) -> usize { self.heart + self.memories + self.night + self.jz }
    fn append(&mut self, other: Self) { self.heart += other.heart; self.memories += other.memories; self.night += other.night; self.jz += other.jz; self.jz_peak = self.jz_peak.max(other.jz_peak); }
}
fn requests(node: &PlanNode) -> Requests {
    match node {
        PlanNode::JzOwnerRequest { request, .. } => Requests { jz: 1, jz_peak: request.resident_bytes, ..Requests::default() },
        PlanNode::HeartOwnerRequest { .. } => Requests { heart: 1, ..Requests::default() },
        PlanNode::MemoriesOwnerRequest { .. } => Requests { memories: 1, ..Requests::default() },
        PlanNode::NightOwnerRequest { .. } => Requests { night: 1, ..Requests::default() },
        PlanNode::Ref { input, .. } | PlanNode::Freeze { input, .. } | PlanNode::Melt { input, .. } => requests(input),
        PlanNode::Rewind { input, .. } => input.as_ref().map_or_else(Requests::default, |n| requests(n)),
        PlanNode::Panels { panels } => panels.iter().fold(Requests::default(), |mut sum, p| { sum.append(requests(&p.input)); sum }),
        PlanNode::Layers { items } => items.iter().fold(Requests::default(), |mut sum, p| { sum.append(requests(&p.input)); sum }),
        PlanNode::PanelsNative { inputs, .. } => inputs.iter().flatten().fold(Requests::default(), |mut sum, input| { sum.append(requests(input)); sum }),
        PlanNode::Transition { from, to, .. } => { let mut sum = requests(from); sum.append(requests(to)); sum },
        _ => Requests::default(),
    }
}
fn bind(node: &mut PlanNode, reservation: &Reservation, counts: &Requests,
    night: Option<&super::super::night_recipe::HostReservation>, jz: Option<&super::super::jz::HostReservation>) {
    match node {
        PlanNode::JzOwnerRequest { request, .. } => request.host = jz.cloned(),
        PlanNode::HeartOwnerRequest { request, .. } => {
            let mut own = reservation.clone(); own.max_live_sessions = counts.heart;
            request.reservation.host = Some(own)
        }
        PlanNode::MemoriesOwnerRequest { request, .. } => {
            request.reservation.host = Some(super::super::memories_recipe::HostReservation {
                recipe_reservation_bytes: reservation.recipe_reservation_bytes,
                session_ceiling_bytes: reservation.session_ceiling_bytes,
                max_live_sessions: counts.memories, raster_byte_limit: reservation.raster_byte_limit,
            });
        }
        PlanNode::NightOwnerRequest { request, .. } => request.host = night.cloned(),
        PlanNode::Ref { input, .. } | PlanNode::Freeze { input, .. } | PlanNode::Melt { input, .. } => bind(input, reservation, counts, night, jz),
        PlanNode::Rewind { input, .. } => { if let Some(input) = input { bind(input, reservation, counts, night, jz); } },
        PlanNode::PanelsNative { inputs, .. } => inputs.iter_mut().flatten().for_each(|n| bind(n, reservation, counts, night, jz)),
        PlanNode::Layers { items } => items.iter_mut().for_each(|p| bind(&mut p.input, reservation, counts, night, jz)),
        PlanNode::Panels { panels } => panels
            .iter_mut()
            .for_each(|p| bind(&mut p.input, reservation, counts, night, jz)),
        PlanNode::Transition { from, to, .. } => {
            bind(from, reservation, counts, night, jz);
            bind(to, reservation, counts, night, jz);
        }
        _ => {}
    }
}
fn native_post_bytes(node: &PlanNode) -> Result<u64, String> {
    match node {
        PlanNode::Road { native_post, .. } => add(
            native_post.plan.allocation_bytes,
            if native_post.dawn.is_some() {
                256 * 16 * 8
            } else {
                0
            },
        ),
        PlanNode::Tunnel { native_post, .. } => Ok(native_post.plan.allocation_bytes),
        PlanNode::Ref { input, .. } | PlanNode::Freeze { input, .. } | PlanNode::Melt { input, .. } => native_post_bytes(input),
        PlanNode::Rewind { input, .. } => input.as_ref().map_or(Ok(0), |n| native_post_bytes(n)),
        PlanNode::Layers { items } => items.iter().try_fold(0, |peak, p| native_post_bytes(&p.input).map(|bytes| peak.max(bytes))),
        PlanNode::Panels { panels } => panels.iter().try_fold(0, |peak, p| {
            native_post_bytes(&p.input).map(|bytes| peak.max(bytes))
        }),
        PlanNode::PanelsNative { inputs, .. } => inputs.iter().flatten().try_fold(0, |peak, n| native_post_bytes(n).map(|bytes| peak.max(bytes))),
        PlanNode::Transition { from, to, .. } => {
            Ok(native_post_bytes(from)?.max(native_post_bytes(to)?))
        }
        _ => Ok(0),
    }
}
fn json_bytes(plan: &Plan) -> Result<u64, String> {
    struct Count(u64);
    impl std::io::Write for Count {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0 = self
                .0
                .checked_add(bytes.len() as u64)
                .filter(|n| *n <= 16 * 1024 * 1024)
                .ok_or_else(|| std::io::Error::other("Heart expanded host plan exceeds16MiB"))?;
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let mut count = Count(0);
    serde_json::to_writer(&mut count, plan).map_err(|e| e.to_string())?;
    Ok(count.0)
}
pub struct Context<'a> {
    pub resources: &'a [Resource],
    pub width: u32,
    pub height: u32,
    pub step: u64,
    pub images: Option<&'a mv_image_dimensions::Context>,
    pub sequences: Option<&'a crate::image_sequence::Context<'a>>,
}
pub(in crate::mv_recipe) fn admit(
    plan: &mut Plan,
    recipe: &Recipe,
    context: Context<'_>,
) -> Result<(), String> {
    let counts = requests(&plan.root);
    let count = counts.total();
    if count == 0 {
        return Ok(());
    }
    if counts.heart > crate::mv_heart_owner::MAX_OWNER_SESSIONS
        || counts.memories > super::super::memories_recipe::MAX_OWNER_SESSIONS
        || counts.jz > super::super::jz::MAX_OWNER_SESSIONS {
        return Err("Expanded native graph exceeds owner session capability".into());
    }
    // Resolution follows source validation. u32::MAX avoids inventing a second
    // source duration while rerunning the identical whole-source raster policy.
    let raster = recipe.raster_reservation(
        context.resources,
        u32::MAX,
        context.width,
        context.height,
        context.step,
        context.images,
    )?;
    let mut outer = raster;
    for resource in context.resources {
        if resource.kind == "image" {
            let image = context
                .images
                .ok_or("Heart native host missing complete decoded image facts")?
                .image(&resource.id)?;
            // Validation charges one raster copy; the native decoder also owns
            // a backing image. Readback/owner packets have their separate lease.
            outer = add(outer, u64::from(image.width) * u64::from(image.height) * 4)?;
        } else {
            outer = add(
                outer,
                resource
                    .byte_length()
                    .checked_mul(3)
                    .ok_or("Heart encoded native host overflow")?,
            )?;
        }
    }
    if let Some(sequences) = context.sequences {
        outer = add(outer, sequences.selected_residency_bytes()?)?;
    }
    outer = add(outer, native_post_bytes(&plan.root)?)?;
    let bitmap_bytes = u64::from(context.width) * u64::from(context.height) * 4;
    // Night sources/frame/GL leases are released before the next occurrence and
    // before Heart/Memories prepare. Final packets and their in-flight copies
    // remain in this caller-owned ledger until the fixed realm is destroyed.
    let retained_night_bytes = bitmap_bytes * counts.night as u64;
    outer = add(outer, bitmap_bytes * (counts.night + counts.memories + counts.jz) as u64 * 3)?;
    outer = add(
        outer,
        json_bytes(plan)?
            .checked_mul(12)
            .ok_or("Heart host transport overflow")?,
    )?;
    // The fixed reservation receipt added to each request remains below4KiB.
    outer = add(outer, count as u64 * 4096 * 12)?;
    let small_count = counts.heart + counts.memories;
    // JIZURA finishes each private replay/lease before the next occurrence and
    // before Heart/Memories prepare. Only its final bitmap packets remain live.
    let jz = if counts.jz > 0 {
        let available = crate::mv_heart_owner::MAX_OWNER_BYTES.checked_sub(outer)
            .filter(|available| counts.jz_peak <= *available)
            .ok_or("JIZURA preparation and retained graph exceed joint256MiB budget")?;
        Some(super::super::jz::HostReservation { recipe_reservation_bytes: outer,
            session_ceiling_bytes: available, max_live_sessions: counts.jz,
            raster_byte_limit: crate::mv_heart_owner::MAX_OWNER_BYTES })
    } else { None };
    let available = if small_count > 0 {
        crate::mv_heart_owner::MAX_OWNER_BYTES.checked_sub(outer)
            .filter(|n| *n >= small_count as u64)
            .ok_or("Native graph consumes joint256MiB small-owner budget")?
    } else { 0 };
    let night = if counts.night > 0 {
        let peak = add(outer, crate::mv_night_owner::MAX_OWNER_BYTES)?;
        if peak > crate::mv_night_owner::MAX_GLOBAL_BYTES {
            return Err("Night preparation and retained graph exceed native global budget".into());
        }
        Some(super::super::night_recipe::HostReservation {
            recipe_reservation_bytes: outer, retained_bitmap_bytes: retained_night_bytes,
            preparation_peak_bytes: peak, raster_byte_limit: crate::mv_heart_owner::MAX_OWNER_BYTES,
        })
    } else { None };
    let reservation = Reservation {
        recipe_reservation_bytes: outer,
        session_ceiling_bytes: if small_count > 0 { available / small_count as u64 } else { 0 },
        max_live_sessions: small_count,
        raster_byte_limit: crate::mv_heart_owner::MAX_OWNER_BYTES,
    };
    bind(&mut plan.root, &reservation, &counts, night.as_ref(), jz.as_ref());
    Ok(())
}
