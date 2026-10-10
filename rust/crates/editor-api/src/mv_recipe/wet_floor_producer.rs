use super::{
    canvas::{Brush, Canvas, Op, Source, Surface},
    fonts::{Admission, Stack},
    model::{Beats, Image, Sample, Settings},
    prepare::ReflectionMask,
};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
const BUDGET: u64 = 512 * 1024 * 1024;
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub version: u8,
    pub profile: &'static str,
    pub mode: String,
    pub logical_size: [u32; 2],
    pub song_ticks: u64,
    pub font_stacks: Vec<Stack>,
    pub surfaces: Vec<Surface>,
    pub operations: Vec<Op>,
    pub allocation_bytes: u64,
    pub operation_count: usize,
}
fn finite(v: &[f64]) -> Result<(), String> {
    if v.iter().any(|n| !n.is_finite() || n.abs() > 1e9) {
        Err("wetFloor nonfinite/oversize primitive".into())
    } else {
        Ok(())
    }
}
fn add(bytes: &mut u64, n: u64) -> Result<(), String> {
    *bytes = bytes.checked_add(n).ok_or("wetFloor allocation overflow")?;
    if *bytes > BUDGET {
        Err("wetFloor allocation budget exceeded".into())
    } else {
        Ok(())
    }
}
fn validate_ops(
    ops: &[Op],
    size: [u32; 2],
    sources: &BTreeMap<String, [u32; 2]>,
    image: &Image,
    fonts: &[Stack],
    bytes: &mut u64,
) -> Result<(), String> {
    let mut depth = 0usize;
    let mut gradients = BTreeSet::new();
    let mut role = None;
    let mut role_stack = Vec::new();
    for op in ops {
        add(bytes, 1024)?;
        match op {
            Op::Save => {
                depth += 1;
                if depth > 32 {
                    return Err("wetFloor canvas stack depth exceeded".into());
                }
                role_stack.push(role);
            }
            Op::Restore => {
                depth = depth.checked_sub(1).ok_or("wetFloor unbalanced restore")?;
                role = role_stack.pop().unwrap();
            }
            Op::Translate { point }
            | Op::Scale { point }
            | Op::MoveTo { point }
            | Op::LineTo { point } => finite(point)?,
            Op::Rotate { angle } => finite(&[*angle])?,
            Op::SetTransform { matrix } => finite(matrix)?,
            Op::Alpha { value } => {
                if !value.is_finite() || !(0.0..=1.0).contains(value) {
                    return Err("wetFloor invalid alpha".into());
                }
            }
            Op::LineWidth { value } | Op::ShadowBlur { value } => {
                finite(&[*value])?;
                if *value < 0.0 || *value > 1024.0 {
                    return Err("wetFloor invalid line/shadow extent".into());
                }
            }
            Op::Composite { value } => {
                if !["source-over", "lighter", "multiply", "destination-in"]
                    .contains(&value.as_str())
                {
                    return Err("wetFloor unsupported composite".into());
                }
            }
            Op::Filter { value } => {
                if ![
                    "none",
                    "blur(1.5px)",
                    "blur(4px)",
                    "blur(10px)",
                    "blur(30px)",
                ]
                .contains(&value.as_str())
                {
                    return Err("wetFloor unsupported filter".into());
                }
            }
            Op::LineCap { value } => {
                if value != "round" {
                    return Err("wetFloor unsupported line cap".into());
                }
            }
            Op::TextAlign { value } => {
                if !["left", "center", "right"].contains(&value.as_str()) {
                    return Err("wetFloor unsupported text alignment".into());
                }
            }
            Op::TextBaseline { value } => {
                if value != "middle" {
                    return Err("wetFloor unsupported text baseline".into());
                }
            }
            Op::LineDash { values } => {
                finite(values)?;
                if values.len() > 8 || values.iter().any(|v| *v < 0.0) {
                    return Err("wetFloor invalid line dash".into());
                }
            }
            Op::LinearGradient { id, points, stops } => {
                finite(points)?;
                validate_gradient(id, stops, &mut gradients)?;
            }
            Op::RadialGradient { id, points, stops } => {
                finite(points)?;
                if points[2] < 0.0 || points[5] < 0.0 {
                    return Err("wetFloor negative gradient radius".into());
                }
                validate_gradient(id, stops, &mut gradients)?;
            }
            Op::FillStyle { brush } | Op::StrokeStyle { brush } => {
                if let Brush::Gradient { id } = brush {
                    if !gradients.contains(id) {
                        return Err("wetFloor undeclared gradient".into());
                    }
                }
            }
            Op::Rect { rect } | Op::FillRect { rect } | Op::ClearRect { rect } => finite(rect)?,
            Op::Ellipse {
                center,
                radii,
                rotation,
                start,
                end,
            } => {
                finite(center)?;
                finite(radii)?;
                finite(&[*rotation, *start, *end])?;
                if radii.iter().any(|n| *n < 0.0) {
                    return Err("wetFloor negative ellipse radius".into());
                }
            }
            Op::Clip { rule } | Op::Fill { rule } => {
                if !["nonzero", "evenodd"].contains(rule) {
                    return Err("wetFloor unsupported fill rule".into());
                }
            }
            Op::DrawImage {
                image: source,
                source_rect,
                destination_rect,
            } => {
                let dims = match source {
                    Source::Resource { id } => {
                        if id != &image.resource.id {
                            return Err("wetFloor undeclared image".into());
                        }
                        [image.width, image.height]
                    }
                    Source::Surface { id } => *sources
                        .get(id)
                        .ok_or("wetFloor forward/self surface sample")?,
                };
                if let Some(rect) = source_rect {
                    finite(rect)?;
                    if rect[2] <= 0.0
                        || rect[3] <= 0.0
                        || rect[2] > dims[0] as f64 * 8.0
                        || rect[3] > dims[1] as f64 * 8.0
                    {
                        return Err("wetFloor invalid source crop".into());
                    }
                }
                finite(destination_rect)?;
                if destination_rect[2] <= 0.0 || destination_rect[3] <= 0.0 {
                    return Err("wetFloor invalid destination size".into());
                }
            }
            Op::Font {
                role: r,
                size,
                weight,
            } => {
                finite(&[*size])?;
                if *size <= 0.0
                    || *size > 256.0
                    || (*r == "mincho800" && *weight != 800)
                    || (*r == "dot400" && *weight != 400)
                    || !fonts.iter().any(|f| f.role == *r)
                {
                    return Err("wetFloor invalid admitted font role".into());
                }
                role = Some(*r);
            }
            Op::FillText { text, point } => {
                finite(point)?;
                let font = fonts
                    .iter()
                    .find(|f| Some(f.role.as_str()) == role)
                    .ok_or("wetFloor text without admitted font")?;
                if text
                    .chars()
                    .any(|ch| !font.routes.contains_key(&ch.to_string()))
                {
                    return Err("wetFloor text outside admitted cmap".into());
                }
                add(bytes, text.len() as u64 * 4)?;
            }
            Op::PutRgba {
                size: s,
                bytes: data,
            }
            | Op::PutAlpha {
                size: s,
                bytes: data,
            } => {
                let channels = if matches!(op, Op::PutRgba { .. }) {
                    4
                } else {
                    1
                };
                if *s != size || data.len() as u64 != s[0] as u64 * s[1] as u64 * channels {
                    return Err("wetFloor pixel payload shape mismatch".into());
                }
                add(bytes, data.len() as u64 * 24)?;
            }
            Op::ShadowColor { value } => {
                if value.len() > 128 {
                    return Err("wetFloor oversized shadow color".into());
                }
            }
            Op::BeginPath | Op::ClosePath | Op::Stroke => {}
        }
    }
    if depth != 0 {
        return Err("wetFloor unbalanced saves".into());
    }
    Ok(())
}
fn validate_gradient(
    id: &String,
    stops: &[(f64, String)],
    ids: &mut BTreeSet<String>,
) -> Result<(), String> {
    if !ids.insert(id.clone())
        || stops.is_empty()
        || stops.len() > 8
        || stops
            .iter()
            .any(|(n, c)| !n.is_finite() || !(0.0..=1.0).contains(n) || c.len() > 128)
        || stops.windows(2).any(|w| w[0].0 > w[1].0)
    {
        return Err("wetFloor invalid native gradient".into());
    }
    Ok(())
}
pub fn produce(
    a: &Settings,
    s: &Sample<'_>,
    image: &Image,
    fonts: &Admission,
    mask: Option<&ReflectionMask>,
) -> Result<Plan, String> {
    a.validate()?;
    s.validate()?;
    if image.resource.kind != "image"
        || image.resource.id != a.bg
        || !(1..=8192).contains(&image.width)
        || !(1..=8192).contains(&image.height)
    {
        return Err("wetFloor admitted background mismatch".into());
    }
    if let Beats::Manual { song_ticks } = &a.beats {
        if song_ticks.len() != s.beats.len()
            || song_ticks
                .iter()
                .zip(s.beats)
                .any(|(tick, b)| *tick as f64 / 120000.0 != *b)
        {
            return Err("wetFloor mapped clock differs from author manual beats".into());
        }
    }
    let expected = [
        ("mincho800", &a.fonts.mincho800, &a.fonts.noto800),
        ("dot400", &a.fonts.dot400, &a.fonts.noto400),
    ];
    if fonts.stacks.len() != 2
        || expected.iter().any(|(r, p, f)| {
            !fonts
                .stacks
                .iter()
                .any(|s| s.role == *r && s.resources[0].id == **p && s.resources[1].id == **f)
        })
    {
        return Err("wetFloor font admission belongs to another settings binding".into());
    }
    let (mut surfaces, operations) = if a.mode == "fall" {
        let mask = mask.ok_or("wetFloor fall requires actual decoded reflection mask")?;
        if mask.image_id != image.resource.id
            || mask.image_sha256 != image.resource.sha256()
            || mask.image_size != [image.width, image.height]
            || mask.sampled_rgba_sha256.len() != 64
        {
            return Err("wetFloor mask binding mismatch".into());
        }
        super::fall::draw(a, s, image, mask)?
    } else {
        if image.width < 1672 || image.height < 430 {
            return Err("wetFloor count background cannot supply original sky crop".into());
        }
        let mut surfaces = Vec::new();
        let mut c = Canvas::new("count");
        super::count::draw(a, s, image, &mut surfaces, &mut c)?;
        (surfaces, c.ops)
    };
    let mut glows = BTreeSet::new();
    for op in surfaces
        .iter()
        .flat_map(|s| s.operations.iter())
        .chain(&operations)
    {
        if let Op::DrawImage {
            image: Source::Surface { id },
            ..
        } = op
        {
            if let Some(color) = id.strip_prefix("glow-") {
                glows.insert(color.to_string());
            }
        }
    }
    let mut ordered: Vec<_> = glows
        .iter()
        .map(|color| Canvas::glow_surface(color))
        .collect();
    ordered.append(&mut surfaces);
    if ordered.len() > 80 {
        return Err("wetFloor surface count budget exceeded".into());
    }
    let operation_count =
        ordered.iter().map(|s| s.operations.len()).sum::<usize>() + operations.len();
    if operation_count > 40000 {
        return Err("wetFloor operation budget exceeded".into());
    }
    let mut bytes = 1920u64 * 1080 * 4 * 4;
    let mut sources = BTreeMap::new();
    for surface in &ordered {
        if surface.size.iter().any(|n| *n == 0 || *n > 8192) || sources.contains_key(&surface.id) {
            return Err("wetFloor invalid/duplicate surface".into());
        }
        let [w, h] = surface.size; // Four retained copies plus padded shadow/filter scratch at the largest fixed radius.
        add(
            &mut bytes,
            w as u64 * h as u64 * 4 * 4 + (w as u64 + 600) * (h as u64 + 600) * 4 * 2,
        )?;
        validate_ops(
            &surface.operations,
            surface.size,
            &sources,
            image,
            &fonts.stacks,
            &mut bytes,
        )?;
        sources.insert(surface.id.clone(), surface.size);
    }
    validate_ops(
        &operations,
        [1920, 1080],
        &sources,
        image,
        &fonts.stacks,
        &mut bytes,
    )?;
    for font in &fonts.stacks {
        for resource in &font.resources {
            add(&mut bytes, resource.byte_length() * 2)?;
        }
    }
    Ok(Plan {
        version: 1,
        profile: "night-wet-floor-v1",
        mode: a.mode.clone(),
        logical_size: [1920, 1080],
        song_ticks: s.song_ticks,
        font_stacks: fonts.stacks.clone(),
        surfaces: ordered,
        operations,
        allocation_bytes: bytes,
        operation_count,
    })
}
