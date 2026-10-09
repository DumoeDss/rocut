//! Flat topologically ordered surfaces: a child may sample an earlier completed
//! surface, never itself, a future surface or recursively create another one.
//! Charge all frame-owned allocations, including grain tiles and their readback.
use super::plan::{Command, PaintKind, Plan};
use std::collections::{BTreeMap, BTreeSet};

const MAX_SURFACES: usize = 64;
const MAX_COMMANDS: usize = 4096;
// The full Plan/JSON/JS numeric payload remains owned until frame completion,
// independently of any canvas release. Match existing grain-plan copy allowance.
const GRAY_PAYLOAD_PIXELS_PER_BYTE: u64 = 9;
// Four f64s plus bounded JSON, JS arrays and retained transport copies.
const RECT_PAYLOAD_PIXELS: u64 = 128;

fn allocation(size: [u32; 2]) -> Result<u64, String> {
    if size.iter().any(|v| !(1..=4096).contains(v)) {
        return Err("Drawing surfaces require dimensions in 1..4096".into());
    }
    // Conservative backing/copy allowance, matching recipe admission units.
    Ok(2 * u64::from(size[0]) * u64::from(size[1]))
}

impl Plan {
    pub(super) fn validate_surfaces(&self, admitted_pixels: u64) -> Result<u64, String> {
        validate_batches(&self.commands)?;
        if self
            .commands
            .iter()
            .any(|c| matches!(c, Command::ReleaseSurface { .. }))
        {
            return self.validate_live_surfaces(admitted_pixels);
        }
        let mut ready = BTreeSet::new();
        let mut pixels = 0u64;
        let mut count = 0usize;
        let mut inspect = |command: &Command, ready: &BTreeSet<&str>| -> Result<(), String> {
            count += 1;
            if count > MAX_COMMANDS {
                return Err("Drawing surface graph exceeds command budget".into());
            }
            match command {
                Command::Surface { .. } | Command::ReleaseSurface { .. } => {
                    return Err("Nested surface definitions are forbidden".into());
                }
                Command::Blit { surface, .. } | Command::SurfacePatternRect { surface, .. }
                    if !ready.contains(surface) =>
                {
                    return Err("Sampling requires an earlier completed surface".into());
                }
                Command::Blit {
                    raster: Some(raster),
                    destination_rect,
                    ..
                } => {
                    pixels = pixels
                        .checked_add(filter_pixels(raster, destination_rect)?)
                        .ok_or("Surface budget overflow")?;
                }
                Command::GrayPixels { size, gray, .. }
                | Command::AlphaPixels {
                    size, alpha: gray, ..
                } => {
                    let cost = allocation(*size)?;
                    if gray.len() as u64 != cost / 2 {
                        return Err("Gray pixels must match the declared dimensions".into());
                    }
                    pixels = pixels
                        .checked_add(cost + gray.len() as u64 * GRAY_PAYLOAD_PIXELS_PER_BYTE)
                        .ok_or("Surface budget overflow")?;
                }
                Command::RectBatch { rects, .. } => {
                    pixels = pixels
                        .checked_add(rects.len() as u64 * RECT_PAYLOAD_PIXELS)
                        .ok_or("Surface budget overflow")?;
                }
                Command::TextStroke {
                    width,
                    cap,
                    join,
                    blur_px,
                    raster_bounds,
                    ..
                } => {
                    pixels = pixels
                        .checked_add(text_filter_pixels(
                            *width,
                            cap,
                            join,
                            *blur_px,
                            raster_bounds,
                        )?)
                        .ok_or("Surface budget overflow")?;
                }
                Command::Grain { size, gray, .. } => {
                    let cost = allocation(*size)?;
                    if gray.len() as u64 != cost / 2 {
                        return Err("Grain bytes must match the declared tile dimensions".into());
                    }
                    pixels = pixels.checked_add(cost).ok_or("Surface budget overflow")?;
                }
                _ => {}
            }
            Ok(())
        };
        // Accumulate named surfaces independently from inline tile allocations.
        let mut surface_pixels = 0u64;
        for command in &self.commands {
            if let Command::Surface { id, size, commands } = command {
                if id.is_empty()
                    || id.len() > 64
                    || ready.contains(id)
                    || ready.len() >= MAX_SURFACES
                {
                    return Err("Drawing surfaces require unique bounded identifiers".into());
                }
                surface_pixels = surface_pixels
                    .checked_add(allocation(*size)?)
                    .ok_or("Surface budget overflow")?;
                for child in commands {
                    inspect(child, &ready)?;
                }
                // Publish only after every child has been validated.
                ready.insert(*id);
            } else {
                inspect(command, &ready)?;
            }
        }
        let total = surface_pixels
            .checked_add(pixels)
            .ok_or("Surface budget overflow")?;
        if total > admitted_pixels {
            return Err("Drawing surface graph exceeds admitted scratch budget".into());
        }
        Ok(total)
    }

    // Only explicit releases opt into live-peak accounting. The historical
    // no-release contract above deliberately keeps its conservative sum budget.
    fn validate_live_surfaces(&self, admitted: u64) -> Result<u64, String> {
        let mut seen = BTreeSet::new();
        let mut ready = BTreeMap::new();
        let mut retained_grain = retained_payload(&self.commands)?;
        let (mut live, mut peak, mut count) = (0u64, retained_grain, 0usize);
        if peak > admitted {
            return Err("Drawing surface graph exceeds admitted scratch budget".into());
        }
        for command in &self.commands {
            count += 1;
            match command {
                Command::ReleaseSurface { surface } => {
                    live = live
                        .checked_sub(
                            ready
                                .remove(surface)
                                .ok_or("Release requires a completed live surface")?,
                        )
                        .ok_or("Invalid live surface accounting")?;
                }
                Command::Surface { id, size, commands } => {
                    if id.is_empty()
                        || id.len() > 64
                        || !seen.insert(*id)
                        || seen.len() > MAX_SURFACES
                    {
                        return Err("Drawing surfaces require unique bounded identifiers, including released surfaces".into());
                    }
                    let pixels = allocation(*size)?;
                    live = live.checked_add(pixels).ok_or("Surface budget overflow")?;
                    peak = peak.max(live + retained_grain);
                    for child in commands {
                        count += 1;
                        let temporary = inspect_live(child, &ready, &mut retained_grain)?;
                        peak = peak.max(live + retained_grain + temporary);
                    }
                    ready.insert(*id, pixels);
                }
                _ => {
                    let temporary = inspect_live(command, &ready, &mut retained_grain)?;
                    peak = peak.max(live + retained_grain + temporary);
                }
            }
            if count > MAX_COMMANDS {
                return Err("Drawing surface graph exceeds command budget".into());
            }
            if peak > admitted {
                return Err("Drawing surface graph exceeds admitted scratch budget".into());
            }
        }
        Ok(peak)
    }
}

fn validate_batches(commands: &[Command]) -> Result<(), String> {
    let (mut count, mut commands_count) = (0usize, 0usize);
    for command in commands.iter().flat_map(|command| {
        let children = if let Command::Surface { commands, .. } = command {
            commands.as_slice()
        } else {
            &[]
        };
        std::iter::once(command).chain(children)
    }) {
        commands_count += 1;
        if commands_count > MAX_COMMANDS {
            return Err("Drawing surface graph exceeds command budget".into());
        }
        if let Command::CircleBatch { circles, .. } = command {
            count = count
                .checked_add(2 * circles.len())
                .ok_or("Drawing batch work overflow")?;
            if circles.iter().any(|v| {
                v.iter().any(|n| !n.is_finite())
                    || v[0].abs() > 1_000_000.0
                    || v[1].abs() > 1_000_000.0
                    || !(0.0..=8192.0).contains(&v[2])
            }) {
                return Err(
                    "Circle batches exceed finite geometry or100000 expanded path-step budget"
                        .into(),
                );
            }
        }
        if let Command::RectBatch { rects, paint, .. } = command {
            // Four rectangle edges and one separate paint; batching is transport only.
            count = count
                .checked_add(5 * rects.len())
                .ok_or("Drawing batch work overflow")?;
            if !matches!(paint.kind, PaintKind::Fill)
                || rects.iter().any(|v| {
                    v.iter().any(|n| !n.is_finite())
                        || v[0].abs() > 1_000_000.0
                        || v[1].abs() > 1_000_000.0
                        || v[2].abs() > 8192.0
                        || v[3].abs() > 8192.0
                })
            {
                return Err(
                    "Rectangle batches require bounded finite geometry and fill paint".into(),
                );
            }
        }
        if count > 100_000 {
            return Err("Drawing batches exceed 100000 expanded geometry/work budget".into());
        }
    }
    Ok(())
}

fn retained_payload(commands: &[Command]) -> Result<u64, String> {
    let mut total = 0u64;
    for command in commands.iter().flat_map(|command| {
        let children = if let Command::Surface { commands, .. } = command {
            commands.as_slice()
        } else {
            &[]
        };
        std::iter::once(command).chain(children)
    }) {
        let cost = match command {
            Command::GrayPixels { gray, .. } | Command::AlphaPixels { alpha: gray, .. } => {
                gray.len() as u64 * GRAY_PAYLOAD_PIXELS_PER_BYTE
            }
            Command::RectBatch { rects, .. } => rects.len() as u64 * RECT_PAYLOAD_PIXELS,
            _ => 0,
        };
        total = total.checked_add(cost).ok_or("Surface budget overflow")?;
    }
    Ok(total)
}

fn text_filter_pixels(
    width: f64,
    cap: &str,
    join: &str,
    blur: f64,
    bounds: &[f64; 4],
) -> Result<u64, String> {
    if !width.is_finite()
        || !(0.0..=8192.0).contains(&width)
        || width == 0.0
        || !["butt", "round"].contains(&cap)
        || !["miter", "round"].contains(&join)
        || bounds.iter().any(|v| !v.is_finite())
        || bounds[2] < 0.0
        || bounds[3] < 0.0
        || bounds[2] > 8192.0
        || bounds[3] > 8192.0
    {
        return Err(
            "Text stroke requires bounded measured raster bounds and stroke settings".into(),
        );
    }
    filter_pixels(
        &super::plan::BlitRaster {
            blur_px: blur,
            smoothing: true,
            smoothing_quality: "low",
        },
        bounds,
    )
}

fn filter_pixels(raster: &super::plan::BlitRaster, rect: &[f64; 4]) -> Result<u64, String> {
    if !raster.blur_px.is_finite()
        || !(0.0..=16.0).contains(&raster.blur_px)
        || !["low", "medium", "high"].contains(&raster.smoothing_quality)
        || rect.iter().any(|v| !v.is_finite())
    {
        return Err("Invalid explicit blit raster settings".into());
    }
    if raster.blur_px == 0.0 {
        return Ok(0);
    }
    let pad = (6.0 * raster.blur_px).ceil();
    let width = rect[2].abs().ceil() + pad;
    let height = rect[3].abs().ceil() + pad;
    if width > 8192.0 || height > 8192.0 {
        return Err("Filtered blit exceeds bounded scratch dimensions".into());
    }
    Ok(2 * width as u64 * height as u64)
}
fn inspect_live(
    command: &Command,
    ready: &BTreeMap<&str, u64>,
    retained: &mut u64,
) -> Result<u64, String> {
    match command {
        Command::Surface { .. } | Command::ReleaseSurface { .. } => {
            Err("Nested surface lifecycle operations are forbidden".into())
        }
        Command::Blit {
            surface,
            raster,
            destination_rect,
            ..
        } => {
            if !ready.contains_key(surface) {
                return Err("Blit requires an earlier completed live surface".into());
            }
            raster
                .as_ref()
                .map_or(Ok(0), |r| filter_pixels(r, destination_rect))
        }
        Command::SurfacePatternRect { surface, .. } => {
            if !ready.contains_key(surface) {
                return Err("Pattern requires an earlier completed live surface".into());
            }
            Ok(0)
        }
        Command::TextStroke {
            width,
            cap,
            join,
            blur_px,
            raster_bounds,
            ..
        } => text_filter_pixels(*width, cap, join, *blur_px, raster_bounds),
        Command::RectBatch { .. } => Ok(0),
        Command::GrayPixels { size, gray, .. }
        | Command::AlphaPixels {
            size, alpha: gray, ..
        }
        | Command::Grain { size, gray, .. } => {
            let cost = allocation(*size)?;
            if gray.len() as u64 != cost / 2 {
                return Err("Raster bytes must match declared tile dimensions".into());
            }
            if matches!(command, Command::Grain { .. }) {
                *retained = retained
                    .checked_add(cost)
                    .ok_or("Surface budget overflow")?;
                Ok(0)
            } else {
                Ok(cost)
            }
        }
        _ => Ok(0),
    }
}

#[cfg(test)]
#[path = "ember_surface_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "ember_surface_primitives_tests.rs"]
mod primitives_tests;
