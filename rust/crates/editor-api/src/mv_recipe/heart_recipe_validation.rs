use super::*;
fn geometry(values: impl IntoIterator<Item = f64>) -> bool {
    values.into_iter().all(|v| range(v, -8192.0, 8192.0))
}
fn height(value: Option<f64>) -> bool {
    value.is_none_or(|v| v > 0.0 && v <= 8192.0)
}
fn night(value: Option<&str>) -> bool {
    value.is_none_or(|s| {
        s.strip_prefix('#').is_some_and(|h| {
            matches!(h.len(), 3 | 4 | 6 | 8) && h.bytes().all(|b| b.is_ascii_hexdigit())
        })
    })
}
pub(in crate::mv_recipe) fn valid(
    scene: &Scene,
    resources: &[Resource],
    start: u64,
    step: u64,
) -> bool {
    let Some(a) = author(scene) else {
        return false;
    };
    let ids: Vec<&str> = std::iter::once(a.source)
        .chain(a.background)
        .chain(a.character)
        .collect();
    if !range(a.bpm, 1.0, 1000.0)
        || ids.iter().enumerate().any(|(i, id)| {
            id.is_empty()
                || ids[..i].contains(id)
                || resources
                    .iter()
                    .filter(|r| r.id.as_str() == *id && r.kind == "image")
                    .count()
                    != 1
        })
        || !u64::from(a.span.start_frame)
            .checked_add(u64::from(a.span.duration_frames))
            .and_then(|v| v.checked_mul(step))
            .and_then(|v| v.checked_add(start))
            .is_some_and(|v| v <= 2_592_000_000)
    {
        return false;
    }
    match scene {
        Scene::HeartShatter { settings: a, .. } => {
            a.break_beat <= 21600
                && geometry([a.x, a.y])
                && a.break_at.is_none_or(|v| range(v, -21600.0, 21600.0))
        }
        Scene::HeartShatterBurn { settings: a, .. } => {
            a.break_beat <= 21600
                && geometry([a.x, a.y])
                && a.break_at.is_none_or(|v| range(v, -21600.0, 21600.0))
        }
        Scene::HeartGather { settings: a, .. } => {
            a.n.is_none_or(|n| (1..=224).contains(&n))
                && height(a.char_h)
                && geometry([a.char_h, a.char_x, a.char_y].into_iter().flatten())
                && a.target.is_none_or(geometry)
        }
        Scene::SunBloom { settings: a, .. } => {
            height(a.char_h)
                && height(a.sun_r)
                && a.fuse_beat.is_none_or(|v| v <= 21600)
                && a.fuse_at.is_none_or(|v| range(v, -21600.0, 21600.0))
                && geometry(
                    [a.sun_x, a.sun_y, a.sun_r, a.char_h, a.char_x, a.char_y]
                        .into_iter()
                        .flatten(),
                )
        }
        Scene::SkyShatter { settings: a, .. } => {
            height(a.char_h)
                && geometry([a.char_x, a.char_h].into_iter().flatten())
                && a.impact.is_none_or(geometry)
                && night(a.night.as_deref())
                && a.bands.is_none_or(|v| (1..=64).contains(&v))
                && a.release_beat.is_none_or(|v| v <= 21600)
        }
        _ => false,
    }
}
