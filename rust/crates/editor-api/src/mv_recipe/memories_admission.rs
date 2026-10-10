use super::{model, NativeFacts};
use crate::programmatic_resources::Resource;
use std::collections::BTreeSet;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontMeasurementRequest {
    pub font: String,
    pub font_size: f64,
    pub weight: u32,
    pub texts: Vec<String>,
}
pub fn measurement_requests(args: &model::Args) -> Result<Vec<FontMeasurementRequest>, String> {
    model::select(args)?;
    let caption: BTreeSet<String> = args
        .photos
        .iter()
        .flat_map(|p| p.caption.chars().map(|ch| ch.to_string()))
        .collect();
    let date: BTreeSet<String> = args
        .photos
        .iter()
        .enumerate()
        .filter(|(_, p)| !p.caption.is_empty())
        .map(|(i, p)| p.date.clone().unwrap_or_else(|| model::DATES[i % 6].into()))
        .filter(|s| !s.is_empty())
        .collect();
    Ok(vec![
        FontMeasurementRequest {
            font: args.caption_font.clone(),
            font_size: 40.0,
            weight: 600,
            texts: caption.into_iter().collect(),
        },
        FontMeasurementRequest {
            font: args.date_font.clone(),
            font_size: 22.0,
            weight: 400,
            texts: date.into_iter().collect(),
        },
    ])
}

pub fn validate(
    args: &model::Args,
    resources: &[Resource],
    facts: &NativeFacts,
) -> Result<u64, String> {
    let selection = model::select(args)?;
    if let Some(issue) = crate::programmatic_resources::validate(resources).first() {
        return Err(issue.message.clone());
    }
    let mut needed: BTreeSet<&str> = args.photos.iter().map(|p| p.bg.as_str()).collect();
    if let Some(id) = selection.character.as_deref() {
        needed.insert(id);
    }
    if facts.images.len() != needed.len() {
        return Err("Memories image facts must exactly name selected sources".into());
    }
    let mut seen = BTreeSet::new();
    let mut source_bytes = 0u64;
    for f in &facts.images {
        if !needed.contains(f.resource.id.as_str())
            || !seen.insert(f.resource.id.as_str())
            || resources.iter().find(|r| r.id == f.resource.id) != Some(&f.resource)
            || f.resource.kind != "image"
        {
            return Err("Memories source descriptor mismatch or duplicate fact".into());
        }
        source_bytes = source_bytes
            .checked_add(
                crate::image_sequence::decoded_image_bytes(f.width, f.height)? * 2
                    + f.resource.byte_length(),
            )
            .ok_or("Memories preparation overflow")?;
    }
    for (fact, id, size, weight) in [
        (&facts.caption, &args.caption_font, 40.0, 600),
        (&facts.date, &args.date_font, 22.0, 400),
    ] {
        let descriptor = serde_json::to_value(&fact.resource).map_err(|e| e.to_string())?;
        let font = &descriptor["font"];
        if &fact.resource.id != id
            || fact.resource.kind != "font"
            || resources.iter().find(|r| &r.id == id) != Some(&fact.resource)
            || fact.size != size
            || fact.weight != weight
            || font["weight"].as_u64() != Some(weight as u64)
            || font["style"].as_str() != Some("normal")
            || fact.widths.len() > 4096
            || fact.widths.iter().any(|(text, w)| {
                text.chars().count() > 128 || !w.is_finite() || *w < 0.0 || *w > 8192.0
            })
        {
            return Err(
                "Memories font metrics must match explicit admitted normal font/size/weight".into(),
            );
        }
        source_bytes = source_bytes
            .checked_add(fact.resource.byte_length())
            .ok_or("Memories preparation overflow")?;
    }
    for (i, p) in args.photos.iter().enumerate() {
        for ch in p.caption.chars() {
            if !facts.caption.widths.contains_key(&ch.to_string()) {
                return Err("Memories caption native Unicode scalar width is missing".into());
            }
        }
        let date = p.date.as_deref().unwrap_or(model::DATES[i % 6]);
        if !p.caption.is_empty() && !date.is_empty() && !facts.date.widths.contains_key(date) {
            return Err("Memories date native full-string width is missing".into());
        }
        if let Some(v) = &p.view {
            let zoom = v.zoom.unwrap_or(1.0);
            if ![v.x, v.y, zoom]
                .iter()
                .all(|v| v.is_finite() && v.abs() <= 16.0)
                || zoom < 0.0
            {
                return Err("Invalid Memories photo crop".into());
            }
        }
    }
    Ok(source_bytes)
}
