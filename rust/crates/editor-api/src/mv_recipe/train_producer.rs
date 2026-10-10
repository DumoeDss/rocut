use super::{
    canvas::{Brush, Canvas, Op, Source, Surface},
    fonts::{Admission, Stack},
    model::{Beats, Image, Sample, Settings},
};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
const BUDGET: u64 = 512 * 1024 * 1024;
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Post {
    pub required: bool,
    pub lut_a: &'static str,
    pub lut_mix: f64,
    pub bloom: f64,
    pub bloom_threshold: f64,
    pub grain: f64,
    pub vignette: f64,
    pub ca: f64,
    pub saturation: f64,
    pub contrast: f64,
    pub boil: f64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub version: u8,
    pub profile: &'static str,
    pub logical_size: [u32; 2],
    pub song_ticks: u64,
    pub frozen: bool,
    pub held_song_seconds: f64,
    pub front: f64,
    pub tail: f64,
    pub velocity: f64,
    pub hero_window: Option<usize>,
    pub font_stacks: Vec<Stack>,
    pub surfaces: Vec<Surface>,
    pub operations: Vec<Op>,
    pub post: Post,
    pub allocation_bytes: u64,
    pub operation_count: usize,
}
fn finite(v: &[f64]) -> Result<(), String> {
    if v.iter().any(|n| !n.is_finite() || n.abs() > 1e9) {
        Err("Train nonfinite/oversize primitive".into())
    } else {
        Ok(())
    }
}
fn add(bytes: &mut u64, n: u64) -> Result<(), String> {
    *bytes = bytes.checked_add(n).ok_or("Train allocation overflow")?;
    if *bytes > BUDGET {
        Err("Train allocation budget exceeded".into())
    } else {
        Ok(())
    }
}
fn validate_ops(
    ops: &[Op],
    size: [u32; 2],
    sources: &BTreeMap<String, [u32; 2]>,
    images: &BTreeMap<String, &Image>,
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
                    return Err("Train canvas stack depth exceeded".into());
                }
                role_stack.push(role);
            }
            Op::Restore => {
                depth = depth.checked_sub(1).ok_or("Train unbalanced restore")?;
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
                    return Err("Train invalid alpha".into());
                }
            }
            Op::LineWidth { value } | Op::ShadowBlur { value } => {
                finite(&[*value])?;
                if *value < 0.0 || *value > 1024.0 {
                    return Err("Train invalid line/shadow extent".into());
                }
            }
            Op::Composite { value } => {
                if ![
                    "source-over",
                    "lighter",
                    "multiply",
                    "destination-in",
                    "screen",
                ]
                .contains(&value.as_str())
                {
                    return Err("Train unsupported composite".into());
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
                    return Err("Train unsupported filter".into());
                }
            }
            Op::LineCap { value } => {
                if value != "round" {
                    return Err("Train unsupported line cap".into());
                }
            }
            Op::TextAlign { value } => {
                if !["left", "center", "right"].contains(&value.as_str()) {
                    return Err("Train unsupported text alignment".into());
                }
            }
            Op::TextBaseline { value } => {
                if value != "middle" {
                    return Err("Train unsupported text baseline".into());
                }
            }
            Op::LineDash { values } => {
                finite(values)?;
                if values.len() > 8 || values.iter().any(|v| *v < 0.0) {
                    return Err("Train invalid line dash".into());
                }
            }
            Op::LinearGradient { id, points, stops } => {
                finite(points)?;
                validate_gradient(id, stops, &mut gradients)?;
            }
            Op::RadialGradient { id, points, stops } => {
                finite(points)?;
                if points[2] < 0.0 || points[5] < 0.0 {
                    return Err("Train negative gradient radius".into());
                }
                validate_gradient(id, stops, &mut gradients)?;
            }
            Op::FillStyle { brush } | Op::StrokeStyle { brush } => {
                if let Brush::Gradient { id } = brush {
                    if !gradients.contains(id) {
                        return Err("Train undeclared gradient".into());
                    }
                }
            }
            Op::Rect { rect }
            | Op::FillRect { rect }
            | Op::ClearRect { rect }
            | Op::StrokeRect { rect } => finite(rect)?,
            Op::RoundRect { rect, radius } => {
                finite(rect)?;
                finite(&[*radius])?;
                if *radius < 0.0 {
                    return Err("Train invalid rounded radius".into());
                }
            }
            Op::Arc {
                center,
                radius,
                start,
                end,
            } => {
                finite(center)?;
                finite(&[*radius, *start, *end])?;
                if *radius < 0.0 {
                    return Err("Train invalid arc radius".into());
                }
            }
            Op::QuadraticCurveTo { points } => finite(points)?,
            Op::BezierCurveTo { points } => finite(points)?,
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
                    return Err("Train negative ellipse radius".into());
                }
            }
            Op::Clip { rule } | Op::Fill { rule } => {
                if !["nonzero", "evenodd"].contains(rule) {
                    return Err("Train unsupported fill rule".into());
                }
            }
            Op::DrawImage {
                image: source,
                source_rect,
                destination_rect,
            } => {
                let dims = match source {
                    Source::Resource { id } => {
                        let image = images.get(id).ok_or("Train undeclared image")?;
                        [image.width, image.height]
                    }
                    Source::Surface { id } => {
                        *sources.get(id).ok_or("Train forward/self surface sample")?
                    }
                };
                if let Some(rect) = source_rect {
                    finite(rect)?;
                    if rect[2] <= 0.0
                        || rect[3] <= 0.0
                        || rect[2] > dims[0] as f64 * 8.0
                        || rect[3] > dims[1] as f64 * 8.0
                    {
                        return Err("Train invalid source crop".into());
                    }
                }
                finite(destination_rect)?;
                if destination_rect[2] <= 0.0 || destination_rect[3] <= 0.0 {
                    return Err("Train invalid destination size".into());
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
                    return Err("Train invalid admitted font role".into());
                }
                role = Some(*r);
            }
            Op::FillText { text, point } => {
                finite(point)?;
                let font = fonts
                    .iter()
                    .find(|f| Some(f.role.as_str()) == role)
                    .ok_or("Train text without admitted font")?;
                if text
                    .chars()
                    .any(|ch| !font.routes.contains_key(&ch.to_string()))
                {
                    return Err("Train text outside admitted cmap".into());
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
                    return Err("Train pixel payload shape mismatch".into());
                }
                add(bytes, data.len() as u64 * 24)?;
            }
            Op::ShadowColor { value } => {
                if value.len() > 128 {
                    return Err("Train oversized shadow color".into());
                }
            }
            Op::BeginPath | Op::ClosePath | Op::Stroke => {}
        }
    }
    if depth != 0 {
        return Err("Train unbalanced saves".into());
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
        return Err("Train invalid native gradient".into());
    }
    Ok(())
}
pub fn produce(
    a: &Settings,
    s: &Sample<'_>,
    images: &[Image],
    fonts: &Admission,
) -> Result<Plan, String> {
    a.validate()?;
    s.validate()?;
    let mut map = BTreeMap::new();
    for image in images {
        if image.resource.kind != "image"
            || image.width == 0
            || image.height == 0
            || image.width > 8192
            || image.height > 8192
            || map.insert(image.resource.id.clone(), image).is_some()
        {
            return Err("Train invalid/duplicate actual decoded images".into());
        }
    }
    let required: BTreeSet<_> = std::iter::once(a.bg.as_str())
        .chain(a.characters())
        .collect();
    if required.iter().any(|id| !map.contains_key(*id)) {
        return Err("Train missing actual background/character image".into());
    }
    map.retain(|id, _| required.contains(id.as_str()));
    if let Beats::Manual { song_ticks } = &a.beats {
        if song_ticks.len() != s.beats.len()
            || song_ticks
                .iter()
                .zip(s.beats)
                .any(|(tick, b)| *tick as f64 / 120000.0 != *b)
        {
            return Err("Train mapped manual clock mismatch".into());
        }
    }
    let expected = [
        ("mincho800", &a.fonts.mincho800, &a.fonts.noto800),
        ("mincho700", &a.fonts.mincho700, &a.fonts.noto700),
        ("dot400", &a.fonts.dot400, &a.fonts.noto400),
    ];
    if fonts.stacks.len() != 3
        || expected.iter().any(|(r, p, f)| {
            !fonts
                .stacks
                .iter()
                .any(|s| s.role == *r && s.resources[0].id == **p && s.resources[1].id == **f)
        })
    {
        return Err("Train exact shared-font preload admission mismatch".into());
    }
    let frame = super::draw::draw(a, s, &map)?;
    let mut glows = BTreeSet::new();
    for op in frame
        .surfaces
        .iter()
        .flat_map(|s| &s.operations)
        .chain(&frame.operations)
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
    let mut surfaces: Vec<_> = glows
        .iter()
        .map(|color| Canvas::glow_surface(color))
        .collect();
    surfaces.extend(frame.surfaces);
    if surfaces.len() > 256 {
        return Err("Train native surface count budget exceeded".into());
    }
    let operation_count =
        surfaces.iter().map(|s| s.operations.len()).sum::<usize>() + frame.operations.len();
    if operation_count > 80000 {
        return Err("Train operation budget exceeded".into());
    }
    let mut bytes = 1920u64 * 1080 * 4 * 4;
    for image in map.values() {
        add(&mut bytes, image.width as u64 * image.height as u64 * 4 * 2)?;
    }
    let mut sources = BTreeMap::new();
    for surface in &surfaces {
        if surface.size.iter().any(|n| *n == 0 || *n > 8192) || sources.contains_key(&surface.id) {
            return Err("Train invalid/duplicate surface".into());
        }
        let [w, h] = surface.size;
        add(
            &mut bytes,
            w as u64 * h as u64 * 4 * 4 + (w as u64 + 128) * (h as u64 + 128) * 4 * 2,
        )?;
        validate_ops(
            &surface.operations,
            surface.size,
            &sources,
            &map,
            &fonts.stacks,
            &mut bytes,
        )?;
        sources.insert(surface.id.clone(), surface.size);
    }
    validate_ops(
        &frame.operations,
        [1920, 1080],
        &sources,
        &map,
        &fonts.stacks,
        &mut bytes,
    )?;
    for stack in &fonts.stacks {
        for resource in &stack.resources {
            add(&mut bytes, resource.byte_length() * 2)?;
        }
    }
    let post = Post {
        required: true,
        lut_a: "P4",
        lut_mix: 0.18,
        bloom: 0.55,
        bloom_threshold: 0.6,
        grain: if frame.frozen { 0.09 } else { 0.06 },
        vignette: 0.28,
        ca: if frame.frozen { 2.9 } else { 1.4 },
        saturation: if frame.frozen { 0.72 } else { 1.0 },
        contrast: 1.05,
        boil: if frame.frozen { 0.6 } else { 1.1 },
    };
    Ok(Plan {
        version: 1,
        profile: "night-train-v1",
        logical_size: [1920, 1080],
        song_ticks: s.song_ticks,
        frozen: frame.frozen,
        held_song_seconds: frame.held_time,
        front: frame.front,
        tail: frame.tail,
        velocity: frame.velocity,
        hero_window: frame.hero_window,
        font_stacks: fonts.stacks.clone(),
        surfaces,
        operations: frame.operations,
        post,
        allocation_bytes: bytes,
        operation_count,
    })
}
