use super::{
    labels::{Label, plain},
    model::TitleRiff,
};
use crate::{
    mv_font_metrics::{AdvanceRequest, BoundsRequest, Request, TextAlign, TextBaseline},
    programmatic_resources::Resource,
};

pub(super) fn ink_request(text: &str) -> BoundsRequest {
    BoundsRequest {
        version: 1,
        text: text.into(),
        font_size_px: 1000.0,
        letter_spacing_px: 0.0,
        align: TextAlign::Left,
        baseline: TextBaseline::Alphabetic,
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
            .ok_or("titleRiff requires all declared font identities")?;
        out.push(Request {
            resource: resource.clone(),
            glyphs: Vec::new(),
            advances: Vec::new(),
            bounds: Vec::new(),
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
fn advance(request: &mut Request, text: String, size: f64) {
    if !request
        .advances
        .iter()
        .any(|v| v.text == text && v.font_size_px == size && v.letter_spacing_px == 0.0)
    {
        request.advances.push(AdvanceRequest {
            text,
            font_size_px: size,
            letter_spacing_px: 0.0,
        });
    }
}
pub(super) fn static_requests(
    a: &TitleRiff,
    resources: &[Resource],
    out: &mut Vec<Request>,
) -> Result<(), String> {
    for text in &a.glyphs {
        bounds(request(out, resources, &a.fonts.title)?, ink_request(text));
    }
    budget(out)
}
pub(super) fn sampled_requests(
    labels: &[Label],
    resources: &[Resource],
    out: &mut Vec<Request>,
) -> Result<(), String> {
    for label in labels {
        let request = request(out, resources, &label.font)?;
        let text = if label.hud {
            plain(&label.text)
        } else {
            label.text.clone()
        };
        if label.hud {
            advance(request, text.clone(), label.size);
            let mut prefix = String::new();
            for ch in label.text.chars() {
                if ch == 'Ō' {
                    advance(request, prefix.clone(), label.size);
                    advance(request, "O".into(), label.size);
                }
                prefix.push(match ch {
                    'Ō' => 'O',
                    'ō' => 'o',
                    other => other,
                });
            }
        }
        // A complete exact string, never per-character width summation. This
        // also binds subtitle/credit's per-frame tracking and every live HUD.
        bounds(
            request,
            BoundsRequest {
                version: 1,
                text,
                font_size_px: label.size,
                letter_spacing_px: label.tracking,
                align: if label.hud || label.align == "left" {
                    TextAlign::Left
                } else if label.align == "right" {
                    TextAlign::Right
                } else {
                    TextAlign::Center
                },
                baseline: if label.baseline == "middle" {
                    TextBaseline::Middle
                } else {
                    TextBaseline::Alphabetic
                },
            },
        );
    }
    budget(out)
}
fn budget(requests: &[Request]) -> Result<(), String> {
    let (mut advance_count, mut advance_scalars, mut bounds_count, mut bounds_scalars) =
        (0, 0, 0, 0);
    for r in requests {
        for a in &r.advances {
            advance_count += 1;
            advance_scalars += a.text.chars().count();
        }
        for b in &r.bounds {
            bounds_count += 1;
            bounds_scalars += b.text.chars().count();
        }
    }
    if requests.len() > 64
        || advance_count > 1024
        || bounds_count > 1024
        || advance_scalars > 65536
        || bounds_scalars > 65536
    {
        return Err("titleRiff exceeds shared per-frame exact text measurement budgets".into());
    }
    Ok(())
}
