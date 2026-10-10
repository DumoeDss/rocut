use super::{
    plan::{Action, Command, Plan},
    Session,
};
use std::collections::BTreeMap;
fn add(t: &mut u64, n: u64) -> Result<(), String> {
    *t = t.checked_add(n).ok_or("Road residency overflow")?;
    Ok(())
}
pub fn base(s: &Session) -> Result<u64, String> {
    let mut total = 1920 * 1080 * 8 * 2 + 2 * 1024 * 1024;
    for r in &s.resources {
        add(&mut total, r.byte_length())?;
    }
    if let Some(f) = &s.character {
        add(
            &mut total,
            crate::image_sequence::decoded_image_bytes(f.width, f.height)? * 2,
        )?;
    }
    if total > s.limit {
        return Err("Road admitted sources/main/foreground exceed ceiling".into());
    }
    Ok(total)
}
fn finite_json(v: &serde_json::Value, key: Option<&str>) -> bool {
    match v {
        serde_json::Value::Null => key == Some("sourceRect"),
        serde_json::Value::Array(a) => a.iter().all(|v| finite_json(v, None)),
        serde_json::Value::Object(o) => o.iter().all(|(k, v)| finite_json(v, Some(k))),
        _ => true,
    }
}
pub fn frame(p: &Plan, s: &Session) -> Result<u64, String> {
    if p.commands.len() > 16384 {
        return Err("Road native primitive count exceeds ceiling".into());
    }
    let mut live: BTreeMap<&str, (u64, usize)> = BTreeMap::new();
    live.insert("main", (1920 * 1080 * 8, 0));
    let (mut resident, mut peak) = (0u64, 0u64);
    let mut root_filter = 0u64;
    for command in &p.commands {
        match command {
            Command::Surface { id, size } => {
                if *id == "main"
                    || live.contains_key(id)
                    || size.iter().any(|v| *v == 0 || *v > 8192)
                {
                    return Err("Invalid Road scratch lifetime or dimensions".into());
                }
                let bytes = size[0] as u64 * size[1] as u64 * 8;
                add(&mut resident, bytes)?;
                live.insert(id, (bytes, 0));
                peak = peak.max(resident);
            }
            Command::Release { surface } => {
                if *surface == "main" {
                    return Err("Road main cannot be released".into());
                }
                let (bytes, depth) = live
                    .remove(surface)
                    .ok_or("Road released unavailable scratch")?;
                if depth != 0 {
                    return Err("Road scratch state stack leaked".into());
                }
                resident -= bytes;
            }
            Command::Capture { surface, .. } | Command::Foreground { surface } => {
                if *surface == "main" || !live.contains_key(surface) {
                    return Err(
                        "Road native capture/foreground requires live distinct scratch".into(),
                    );
                }
            }
            Command::Native { target, action } => {
                if !live.contains_key(target) {
                    return Err("Road native target is unavailable".into());
                }
                match action {
                    Action::Save => live.get_mut(target).unwrap().1 += 1,
                    Action::Restore => {
                        let depth = &mut live.get_mut(target).unwrap().1;
                        if *depth == 0 {
                            return Err("Road native state stack underflow".into());
                        }
                        *depth -= 1;
                    }
                    Action::Filter { blur_px } => {
                        if !blur_px.is_finite() || !(0.0..=8.0).contains(blur_px) {
                            return Err("Invalid Road native blur".into());
                        }
                        if *blur_px > 0.0 {
                            let n = live[target].0 * 2;
                            if *target == "main" {
                                root_filter = root_filter.max(n);
                            } else {
                                peak = peak.max(resident + n);
                            }
                        }
                    }
                    Action::Image {
                        source,
                        source_kind,
                        ..
                    } => {
                        if *source_kind == "surface" {
                            if source == target || !live.contains_key(source.as_str()) {
                                return Err("Road sampled unavailable or feedback scratch".into());
                            }
                        } else if *source_kind != "asset"
                            || s.character.as_ref().map(|f| f.resource.id.as_str())
                                != Some(source.as_str())
                        {
                            return Err("Road sampled undeclared image".into());
                        }
                    }
                    _ => {}
                }
            }
        }
    }
    if live.len() != 1 || live["main"].1 != 0 {
        return Err("Road frame leaked scratch or native state".into());
    }
    let json = serde_json::to_vec(p).map_err(|e| e.to_string())?;
    if json.len() > 16 * 1024 * 1024
        || !finite_json(
            &serde_json::from_slice(&json).map_err(|e| e.to_string())?,
            None,
        )
    {
        return Err(
            "Road native plan contains non-finite values or exceeds transport ceiling".into(),
        );
    }
    let mut total = base(s)?;
    add(&mut total, peak)?;
    add(&mut total, root_filter)?;
    add(&mut total, json.len() as u64 * 12)?;
    if total > s.limit {
        return Err("Road joint native frame residency exceeds ceiling".into());
    }
    Ok(total)
}
