//! Flat, instance-aware routing. No author-ID fallback or implicit missing bus.
use super::facts::bounded_text;
use super::snapshot::{Bus, Track};
use std::collections::HashSet;

pub(super) fn audible_media(track: &Track) -> bool {
    // @hyperframes/core 0.8.139 audibleVideo.js. The attributes, not the
    // transport-forced media.muted property, determine video participation.
    track.kind == "audio"
        || (!track.attributes.muted
            && track
                .attributes
                .has_audio
                .as_deref()
                .is_none_or(|value| value == "true"))
}

fn instance_id(id: &str, used: &mut HashSet<String>) -> Result<(), String> {
    bounded_text(Some(id), 256, "instance ID")?;
    if id.trim().is_empty() || id.chars().any(char::is_control) || !used.insert(id.to_owned()) {
        return Err("HyperFrames graph requires unique nonempty compiled instance IDs".into());
    }
    Ok(())
}

pub(super) fn resolve_membership(
    tracks: &[Track],
    buses: &[Bus],
) -> Result<Vec<Option<String>>, String> {
    let mut used = HashSet::new();
    for bus in buses {
        instance_id(&bus.instance_id, &mut used)?;
        bounded_text(bus.author_id.as_deref(), 256, "bus author ID")?;
    }
    let bus_ids: HashSet<&str> = buses.iter().map(|bus| bus.instance_id.as_str()).collect();
    let mut membership = Vec::with_capacity(tracks.len());
    for track in tracks {
        instance_id(&track.instance_id, &mut used)?;
        bounded_text(track.author_id.as_deref(), 256, "track author ID")?;
        bounded_text(
            track.attributes.group_render_id.as_deref(),
            256,
            "group instance ID",
        )?;
        bounded_text(
            track.attributes.group_author_id.as_deref(),
            256,
            "group author ID",
        )?;
        if !audible_media(track) {
            // These video attributes are inert upstream; keep the track but do
            // not invent membership merely because an inert attribute exists.
            membership.push(None);
            continue;
        }
        let group = track
            .attributes
            .group_render_id
            .as_deref()
            .filter(|id| !id.is_empty());
        if let Some(group) = group {
            if !bus_ids.contains(group) {
                return Err(
                    "HyperFrames graph member references an undeclared bus instance".into(),
                );
            }
        } else if track
            .attributes
            .group_author_id
            .as_deref()
            .is_some_and(|id| !id.is_empty())
        {
            return Err(
                "HyperFrames graph membership requires a compiled bus instance stamp".into(),
            );
        }
        membership.push(group.map(str::to_owned));
    }
    Ok(membership)
}
