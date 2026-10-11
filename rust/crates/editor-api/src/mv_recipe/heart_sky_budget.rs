//! Sky-specific complete graph/lifetime admission; original star raster has >4096 commands.
use super::{
    BackgroundFact,
    plan::{self, HeartCommand, native},
    sky::Session,
    sky_plan::{Command, Plan, SkyCommand},
};
use std::collections::BTreeMap;
const MAX: u64 = 256 * 1024 * 1024;
fn add(total: &mut u64, v: u64) -> Result<(), String> {
    *total = total.checked_add(v).ok_or("Sky residency overflow")?;
    Ok(())
}
fn size_bytes(size: [u32; 2]) -> Result<u64, String> {
    if size.iter().any(|v| !(1..=4096).contains(v)) {
        return Err("Sky scratch dimensions exceed limits".into());
    }
    Ok(size[0] as u64 * size[1] as u64 * 8)
}
struct Graph<'a> {
    ready: BTreeMap<&'static str, u64>,
    live: u64,
    peak: u64,
    count: usize,
    source: &'a str,
    character: &'a str,
}
impl Graph<'_> {
    fn surface(
        &mut self,
        id: &'static str,
        size: [u32; 2],
        children: impl FnOnce(&mut Self) -> Result<u64, String>,
    ) -> Result<(), String> {
        if self.ready.contains_key(id) {
            return Err("Sky surface was not released before reuse".into());
        }
        let bytes = size_bytes(size)?;
        self.ready.insert(id, bytes);
        add(&mut self.live, bytes)?;
        let scratch = children(self)?;
        self.peak = self.peak.max(
            self.live
                .checked_add(scratch)
                .ok_or("Sky residency overflow")?,
        );
        Ok(())
    }
    fn command(&mut self, c: &Command, target: Option<&str>) -> Result<u64, String> {
        self.count += 1;
        if self.count > 16384 {
            return Err("Sky command graph exceeds16384 limit".into());
        }
        match c {
            Command::Sky(SkyCommand::Surface { id, size, commands }) => {
                if target.is_some() {
                    return Err("Nested sky surfaces forbidden".into());
                }
                self.surface(id, *size, |g| {
                    let mut scratch = 0;
                    for c in commands {
                        scratch = scratch.max(g.command(c, Some(id))?);
                    }
                    Ok(scratch)
                })?;
                Ok(0)
            }
            Command::Sky(SkyCommand::FilteredPath {
                transform,
                operations,
                path,
                paints,
                blur_px,
            }) => {
                if *transform != super::draw::ID
                    || !operations.is_empty()
                    || path.len() > 51
                    || paints.len() != 1
                    || *blur_px != 10.0
                {
                    return Err("Invalid Sky native filter primitive".into());
                }
                let bytes = target
                    .and_then(|t| self.ready.get(t))
                    .copied()
                    .ok_or("Sky filter must target an admitted surface")?;
                Ok(bytes * 2)
            }
            Command::Heart(c) => self.heart(c, target),
        }
    }
    fn heart(&mut self, c: &plan::Command, target: Option<&str>) -> Result<u64, String> {
        match c {
            plan::Command::Heart(HeartCommand::Surface { id, size, commands }) => {
                if target.is_some() {
                    return Err("Nested Heart/Sky surfaces forbidden".into());
                }
                self.surface(id, *size, |g| {
                    let mut scratch = 0;
                    for c in commands {
                        g.count += 1;
                        scratch = scratch.max(g.heart(c, Some(id))?);
                    }
                    Ok(scratch)
                })?;
                Ok(0)
            }
            plan::Command::Native(native::Command::ReleaseSurface { surface }) => {
                if target.is_some() {
                    return Err("Sky release inside a target surface forbidden".into());
                }
                let bytes = self
                    .ready
                    .remove(surface)
                    .ok_or("Sky released unavailable surface")?;
                self.live -= bytes;
                Ok(0)
            }
            plan::Command::Native(
                native::Command::Blit { surface, .. }
                | native::Command::SurfacePatternRect { surface, .. },
            ) => {
                if Some(*surface) == target || !self.ready.contains_key(surface) {
                    return Err("Sky sampled an unavailable or feedback surface".into());
                }
                Ok(0)
            }
            plan::Command::Native(native::Command::Image { image, .. }) => {
                if image != self.source && image != self.character {
                    return Err("Sky references an unadmitted image".into());
                }
                Ok(0)
            }
            plan::Command::Heart(HeartCommand::ShadowPath { shadow, .. }) => {
                if !shadow.blur_px.is_finite()
                    || !(0.0..=16.0).contains(&shadow.blur_px)
                    || shadow.offset != [0.0, 0.0]
                {
                    return Err("Invalid Sky shadow primitive".into());
                }
                Ok(target
                    .and_then(|t| self.ready.get(t))
                    .copied()
                    .ok_or("Sky shadow must target an admitted surface")?
                    * 2)
            }
            plan::Command::Native(
                native::Command::Surface { .. } | native::Command::AppendSurface { .. },
            )
            | plan::Command::Heart(
                HeartCommand::AppendSurface { .. } | HeartCommand::PreparedImage { .. },
            ) => Err("Unsupported Sky lifetime or image transport".into()),
            _ => Ok(0),
        }
    }
}
pub fn validate(
    plan: &Plan,
    session: &Session,
    character: &BackgroundFact<'_>,
) -> Result<u64, String> {
    let mut total =
        crate::image_sequence::decoded_image_bytes(session.dimensions[0], session.dimensions[1])?
            * 2
            + session.source.byte_length();
    add(
        &mut total,
        crate::image_sequence::decoded_image_bytes(character.width, character.height)? * 2
            + character.resource.byte_length(),
    )?;
    add(
        &mut total,
        session.pieces.capacity() as u64 * std::mem::size_of::<super::sky_geometry::Piece>() as u64,
    )?;
    for p in &session.pieces {
        add(&mut total, p.polygon.capacity() as u64 * 16)?;
    }
    add(&mut total, 2 * 1024 * 1024)?; // all fixed night-vector capacities and metadata
    let mut graph = Graph {
        ready: BTreeMap::new(),
        live: 0,
        peak: 0,
        count: 0,
        source: &session.source.id,
        character: &character.resource.id,
    };
    for c in &plan.commands {
        graph.command(c, None)?;
    }
    if graph.count > 16384 || !graph.ready.is_empty() {
        return Err("Sky command graph is oversized or leaves native surfaces resident".into());
    }
    add(&mut total, graph.peak)?;
    add(&mut total, 1920 * 1080 * 8)?;
    let json = serde_json::to_vec(plan).map_err(|e| e.to_string())?;
    if json.len() > 16 * 1024 * 1024 {
        return Err("Sky plan serialization exceeds limit".into());
    }
    add(&mut total, json.len() as u64 * 12)?;
    if total > MAX {
        return Err("Sky joint frame residency exceeds256MiB ceiling".into());
    }
    Ok(total)
}
