use super::{
    plan::{
        common::{self, native},
        Command, Frame, MemoryCommand, Raster,
    },
    Session,
};
use std::collections::BTreeMap;
const MAX: u64 = 256 * 1024 * 1024;
fn add(t: &mut u64, n: u64) -> Result<(), String> {
    *t = t.checked_add(n).ok_or("Memories residency overflow")?;
    Ok(())
}
fn bytes(size: [u32; 2]) -> Result<u64, String> {
    if size.iter().any(|v| !(1..=4096).contains(v)) {
        return Err("Memories surface dimensions exceed limits".into());
    }
    Ok(size[0] as u64 * size[1] as u64 * 8)
}
struct Graph<'a> {
    live: BTreeMap<&'static str, u64>,
    resident: u64,
    peak: u64,
    count: usize,
    rasters: Vec<&'a Raster>,
    session: &'a Session,
}
impl Graph<'_> {
    fn command(&mut self, c: &Command, target: Option<&str>) -> Result<u64, String> {
        self.count += 1;
        if self.count > 8192 {
            return Err("Memories command graph exceeds limits".into());
        }
        match c {
            Command::Memories(MemoryCommand::Surface { id, size, commands }) => {
                if target.is_some() || self.live.contains_key(id) {
                    return Err("Invalid Memories surface lifetime".into());
                }
                let n = bytes(*size)?;
                self.live.insert(id, n);
                add(&mut self.resident, n)?;
                let mut scratch = 0;
                for c in commands {
                    scratch = scratch.max(self.command(c, Some(id))?);
                }
                self.peak = self.peak.max(self.resident + scratch);
                Ok(0)
            }
            Command::Memories(MemoryCommand::Pixels { raster }) => {
                if !self.rasters.contains(&raster)
                    || target.and_then(|id| self.live.get(id)).copied()
                        != Some(raster.width as u64 * raster.height as u64 * 8)
                {
                    return Err("Memories pixel upload is not current admitted frame raster".into());
                }
                Ok(0)
            }
            Command::Memories(MemoryCommand::PreparedImage { raster, .. }) => {
                if !self.rasters.contains(&raster) {
                    return Err("Memories sampled unadmitted prepared raster".into());
                }
                Ok(0)
            }
            Command::Memories(
                MemoryCommand::FilteredRect { blur_px, .. }
                | MemoryCommand::FilteredPath { blur_px, .. },
            ) => {
                if !blur_px.is_finite() || !(0.0..=14.0).contains(blur_px) {
                    return Err("Invalid Memories native filter".into());
                }
                Ok(target
                    .and_then(|id| self.live.get(id))
                    .copied()
                    .ok_or("Memories filter requires admitted target")?
                    * 2)
            }
            Command::Memories(MemoryCommand::ClippedText { font, .. }) => {
                if font != &self.session.args.caption_font && font != &self.session.args.date_font {
                    return Err("Memories text references an unadmitted font".into());
                }
                Ok(0)
            }
            Command::Memories(MemoryCommand::RoundRect { .. }) => Ok(0),
            Command::Native(common::Command::Native(native::Command::ReleaseSurface {
                surface,
            })) => {
                if target.is_some() {
                    return Err("Memories release inside scratch forbidden".into());
                }
                let n = self
                    .live
                    .remove(surface)
                    .ok_or("Memories released missing scratch")?;
                self.resident -= n;
                Ok(0)
            }
            Command::Native(common::Command::Native(native::Command::Blit {
                surface,
                raster,
                ..
            })) => {
                if Some(*surface) == target || !self.live.contains_key(surface) {
                    return Err("Memories sampled unavailable or feedback surface".into());
                }
                if let Some(filter) = raster {
                    if !filter.blur_px.is_finite() || !(0.0..=14.0).contains(&filter.blur_px) {
                        return Err("Invalid Memories blit filter".into());
                    }
                    return Ok(target
                        .and_then(|id| self.live.get(id))
                        .copied()
                        .ok_or("Memories filtered blit requires admitted scratch target")?
                        * 2);
                }
                Ok(0)
            }
            Command::Native(
                common::Command::Native(
                    native::Command::Surface { .. }
                    | native::Command::AppendSurface { .. }
                    | native::Command::PreparedPatch { .. }
                    | native::Command::Image { .. }
                    | native::Command::Text { .. }
                    | native::Command::TextStroke { .. },
                )
                | common::Command::Heart(
                    common::HeartCommand::Surface { .. }
                    | common::HeartCommand::AppendSurface { .. }
                    | common::HeartCommand::PreparedImage { .. },
                ),
            ) => Err("Unsupported Memories frame owner transport".into()),
            _ => Ok(0),
        }
    }
}
pub fn frame(frame: &Frame, s: &Session) -> Result<u64, String> {
    let mut total = 0;
    for f in &s.facts.images {
        add(
            &mut total,
            crate::image_sequence::decoded_image_bytes(f.width, f.height)? * 2
                + f.resource.byte_length(),
        )?;
    }
    add(
        &mut total,
        s.facts.caption.resource.byte_length() + s.facts.date.resource.byte_length(),
    )?;
    let static_rasters = s.prepared()?;
    for (_, rgba) in &static_rasters {
        add(&mut total, rgba.len() as u64 * 3)?;
    }
    for p in &s.photos {
        add(
            &mut total,
            p.field.values.capacity() as u64 * 4
                + p.field.patches.capacity() as u64 * 4
                + 64 * 1024,
        )?;
    }
    for p in &frame.payloads {
        if p.raster.binding_sha256 != s.binding
            || p.rgba.len() != p.raster.width as usize * p.raster.height as usize * 4
        {
            return Err("Memories frame payload binding mismatch".into());
        }
        use sha2::{Digest, Sha256};
        if format!("{:x}", Sha256::digest(&p.rgba)) != p.raster.rgba_sha256 {
            return Err("Memories frame pixel SHA mismatch".into());
        }
        add(&mut total, p.rgba.capacity() as u64 * 3)?;
    }
    let rasters = static_rasters
        .into_iter()
        .map(|(r, _)| r)
        .chain(frame.payloads.iter().map(|p| &p.raster))
        .collect();
    let mut graph = Graph {
        live: BTreeMap::new(),
        resident: 0,
        peak: 0,
        count: 0,
        rasters,
        session: s,
    };
    for c in &frame.plan.commands {
        graph.command(c, None)?;
    }
    if !graph.live.is_empty() {
        return Err("Memories frame leaves scratch resident".into());
    }
    add(&mut total, graph.peak)?;
    add(&mut total, 1920 * 1080 * 8)?;
    let json = serde_json::to_vec(&frame.plan).map_err(|e| e.to_string())?;
    if json.len() > 16 * 1024 * 1024 {
        return Err("Memories plan JSON exceeds limits".into());
    }
    add(&mut total, json.len() as u64 * 12 + 2 * 1024 * 1024)?;
    if total > MAX.min(s.stage.limit) {
        return Err("Memories joint frame residency exceeds admission ceiling".into());
    }
    Ok(total)
}
