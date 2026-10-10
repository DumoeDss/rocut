//! Joint session + serialized plan + native scratch residency. No silent quality reductions.
use super::{
    BackgroundFact, Plan, Session,
    plan::{Command, HeartCommand, native},
};
#[path = "heart_surface_lifetime.rs"]
mod lifetime;
use lifetime::Lifetimes;
const MAX: u64 = 256 * 1024 * 1024;
fn add(total: &mut u64, cost: u64) -> Result<(), String> {
    *total = total.checked_add(cost).ok_or("Heart budget overflow")?;
    Ok(())
}
fn image_bytes(size: [u32; 2]) -> Result<u64, String> {
    if size.iter().any(|v| !(1..=4096).contains(v)) {
        return Err("Heart surface dimensions exceed limits".into());
    }
    Ok(size[0] as u64 * size[1] as u64 * 8)
}
fn inspect(
    command: &Command,
    ready: &Lifetimes,
    target: Option<&str>,
    count: &mut usize,
    shadow_cost: &mut u64,
) -> Result<(), String> {
    *count += 1;
    if *count > 4096 {
        return Err("Heart command graph exceeds limits".into());
    }
    match command {
        Command::Heart(
            HeartCommand::Surface { .. }
            | HeartCommand::OwnedSurface { .. }
            | HeartCommand::AppendSurface { .. }
            | HeartCommand::OwnedReleaseSurface { .. },
        ) => return Err("Nested Heart surfaces are forbidden".into()),
        Command::Heart(HeartCommand::PreparedImage { image, .. }) => {
            if image.width == 0 || image.height == 0 {
                return Err("Invalid Heart prepared image dimensions".into());
            }
        }
        Command::Heart(HeartCommand::ShadowPath { shadow, .. }) => {
            if !shadow.blur_px.is_finite()
                || !(0.0..=16.0).contains(&shadow.blur_px)
                || shadow.offset != [0.0, 0.0]
            {
                return Err("Invalid Heart shadow primitive".into());
            }
            let bytes = target
                .and_then(|v| ready.bytes(v).ok())
                .ok_or("Heart shadow must render into an admitted surface")?;
            *shadow_cost = (*shadow_cost).max(bytes * 2);
        }
        Command::Native(
            native::Command::Blit { surface, .. }
            | native::Command::SurfacePatternRect { surface, .. },
        ) => {
            if Some(*surface) == target {
                return Err("Heart surface feedback is forbidden".into());
            }
            ready.sample(surface, target)?;
        }
        Command::Heart(HeartCommand::OwnedBlit { surface, .. }) => ready.sample(surface, target)?,
        Command::Native(
            native::Command::Surface { .. }
            | native::Command::AppendSurface { .. }
            | native::Command::ReleaseSurface { .. },
        ) => return Err("Use the explicit Heart surface lifetime transport".into()),
        _ => {}
    }
    Ok(())
}
pub fn validate(
    plan: &Plan,
    session: &Session,
    bg: Option<&BackgroundFact<'_>>,
) -> Result<u64, String> {
    let mut resident = 0u64;
    // Source decoder RGBA/backing, Rust body RGBA and admitted derived bitmap.
    // These distinct owners must not be collapsed into one two-copy allocation.
    add(&mut resident, session.body.body_rgba.capacity() as u64 * 4)?;
    add(
        &mut resident,
        session.body.labels.capacity() as u64 * std::mem::size_of::<Option<usize>>() as u64,
    )?;
    add(
        &mut resident,
        session.body.components.capacity() as u64
            * std::mem::size_of::<super::components::Component>() as u64,
    )?;
    for chip in &session.body.chips {
        // Rust crop, provider upload/readback bytes and admitted native bitmap.
        add(&mut resident, chip.rgba.capacity() as u64 * 3)?;
    }
    for edge in &session.glass.fracture.edges {
        add(&mut resident, edge.points.capacity() as u64 * 16)?;
    }
    for cell in &session.glass.fracture.cells {
        add(&mut resident, cell.polygon.capacity() as u64 * 16)?;
    }
    add(
        &mut resident,
        session.glass.shards.capacity() as u64 * std::mem::size_of::<super::shards::Shard>() as u64,
    )?;
    add(&mut resident, session.binding.source.byte_length())?;
    if let Some(bg) = bg {
        add(
            &mut resident,
            crate::image_sequence::decoded_image_bytes(bg.width, bg.height)? * 2
                + bg.resource.byte_length(),
        )?;
    }
    let json = serde_json::to_vec(plan).map_err(|e| e.to_string())?;
    if json.len() > 16 * 1024 * 1024 {
        return Err("Heart serialized plan exceeds limits".into());
    }
    // Rust command vectors/JSON, transport bytes, JS parsed arrays and provider serialization.
    add(
        &mut resident,
        json.len() as u64 * 12 + 1920 * 1080 * 8 + 1024 * 1024,
    )?;
    let mut ready = Lifetimes::default();
    let mut live = 0u64;
    let mut peak = 0u64;
    let mut count = 0usize;
    let mut shadow = 0u64;
    for command in &plan.commands {
        match command {
            Command::Heart(HeartCommand::Surface { id, size, commands }) => {
                count += 1;
                let bytes = image_bytes(*size)?;
                ready.create(id, bytes)?;
                add(&mut live, bytes)?;
                for c in commands {
                    inspect(c, &ready, Some(id), &mut count, &mut shadow)?;
                }
                peak = peak.max(live + shadow);
            }
            Command::Heart(HeartCommand::OwnedSurface { id, size, commands }) => {
                count += 1;
                let bytes = image_bytes(*size)?;
                ready.create(id, bytes)?;
                add(&mut live, bytes)?;
                for c in commands {
                    inspect(c, &ready, Some(id), &mut count, &mut shadow)?;
                }
                peak = peak.max(live + shadow);
            }
            Command::Heart(HeartCommand::AppendSurface { surface, commands }) => {
                ready.sample(surface, None)?;
                for c in commands {
                    inspect(c, &ready, Some(surface), &mut count, &mut shadow)?;
                }
            }
            Command::Native(native::Command::ReleaseSurface { surface }) => {
                count += 1;
                live = live
                    .checked_sub(ready.release(surface)?)
                    .ok_or("Heart lifetime underflow")?;
            }
            Command::Heart(HeartCommand::OwnedReleaseSurface { surface }) => {
                count += 1;
                live = live
                    .checked_sub(ready.release(surface)?)
                    .ok_or("Heart lifetime underflow")?;
            }
            c => inspect(c, &ready, None, &mut count, &mut shadow)?,
        }
        if count > 4096 {
            return Err("Heart command graph exceeds limits".into());
        }
    }
    ready.finish()?;
    add(&mut resident, peak)?;
    if resident > MAX {
        return Err("Heart joint residency exceeds 256 MiB".into());
    }
    Ok(resident)
}
