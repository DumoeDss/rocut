use super::{labels::Label, model::KanjiSlam};
use crate::{
    mv_font_metrics::{BoundsRequest, Request, TextAlign, TextBaseline},
    programmatic_resources::Resource,
};
pub(super) fn ink_request(ch: char) -> BoundsRequest {
    BoundsRequest {
        version: 1,
        text: ch.to_string(),
        font_size_px: 1500.0,
        letter_spacing_px: 0.0,
        align: TextAlign::Left,
        baseline: TextBaseline::Alphabetic,
    }
}
pub(super) fn label_request(l: &Label) -> BoundsRequest {
    BoundsRequest {
        version: 1,
        text: l.text.clone(),
        font_size_px: l.size,
        letter_spacing_px: 0.0,
        align: if l.align == "center" {
            TextAlign::Center
        } else {
            TextAlign::Left
        },
        baseline: TextBaseline::Middle,
    }
}
fn request<'a>(
    out: &'a mut Vec<Request>,
    resources: &[Resource],
    id: &str,
) -> Result<&'a mut Request, String> {
    let index = if let Some(i) = out.iter().position(|r| r.resource.id == id) {
        i
    } else {
        let resource = resources
            .iter()
            .find(|r| r.id == id && r.kind == "font")
            .ok_or("kanjiSlam needs all three explicit font roles")?;
        out.push(Request {
            resource: resource.clone(),
            glyphs: vec![],
            advances: vec![],
            bounds: vec![],
        });
        out.len() - 1
    };
    Ok(&mut out[index])
}
fn bounds(request: &mut Request, b: BoundsRequest) {
    if !request.bounds.iter().any(|v| {
        v.text == b.text
            && v.font_size_px == b.font_size_px
            && v.letter_spacing_px == b.letter_spacing_px
            && v.align == b.align
            && v.baseline == b.baseline
    }) {
        request.bounds.push(b);
    }
}
pub(super) fn static_requests(
    a: &KanjiSlam,
    resources: &[Resource],
    out: &mut Vec<Request>,
) -> Result<(), String> {
    for id in [&a.fonts.monument, &a.fonts.lyric, &a.fonts.counter] {
        // Hidden shots still require every authored font, but an unused role
        // is not a measurement request: the shared facts contract correctly
        // rejects empty glyph/advance/bounds requests.
        if resources
            .iter()
            .filter(|r| r.id == *id && r.kind == "font")
            .count()
            != 1
        {
            return Err("kanjiSlam needs all three explicit font roles".into());
        }
    }
    for ch in a.glyphs.iter().flat_map(|s| s.chars()) {
        bounds(request(out, resources, &a.fonts.monument)?, ink_request(ch));
    }
    budget(out)
}
pub(super) fn sampled_requests(
    labels: &[Label],
    resources: &[Resource],
    out: &mut Vec<Request>,
) -> Result<(), String> {
    for l in labels {
        bounds(request(out, resources, &l.font)?, label_request(l));
    }
    budget(out)
}
fn budget(out: &[Request]) -> Result<(), String> {
    let count: usize = out.iter().map(|r| r.bounds.len()).sum();
    let scalars: usize = out
        .iter()
        .flat_map(|r| &r.bounds)
        .map(|b| b.text.chars().count())
        .sum();
    if out.len() > 64 || count > 1024 || scalars > 65536 {
        Err("kanjiSlam exceeds exact font request budgets".into())
    } else {
        Ok(())
    }
}
