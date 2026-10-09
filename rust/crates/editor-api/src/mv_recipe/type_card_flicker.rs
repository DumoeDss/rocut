use super::{
    Sample, beats, finishing, glitch, math,
    model::{Flicker, Hold},
    plan,
};

pub(super) fn resolve(a: &Flicker, s: &Sample<'_>) -> Result<plan::Plan, String> {
    let phase = beats::phase(&a.beats, s)?;
    let l = &a.layouts[phase.layout];
    let u = phase.since;
    let sample = s.song_ticks * 15 / 120_000;
    let (flick, collapse) = match l.hold {
        Hold::Pulse { seconds } => (
            if u < seconds {
                if sample % 3 == 1 { 0.55 } else { 1.0 }
            } else {
                (1.0 - (u - seconds) / 0.1).max(0.0)
            },
            math::clamp((u - seconds + 0.06) / 0.12),
        ),
        Hold::Sustain => (1.0, 0.0),
    };
    let sy = 1.0 - 0.97 * collapse * collapse;
    let sx = 1.0 + 0.3 * collapse;
    let transform = [
        sx,
        0.0,
        0.0,
        sy,
        s.width / 2.0 * (1.0 - sx),
        s.height / 2.0 * (1.0 - sy),
    ];
    let mut result = plan::Flicker {
        transform,
        text: Vec::new(),
        frame: None,
        indicator: None,
        erasers: Vec::new(),
        bands: Vec::new(),
        blocks: Vec::new(),
        kick_glow: None,
        idle_scan: None,
        morse: finishing::morse(&a.morse, s),
    };
    if flick > 0.0 {
        let split =
            (5.0 + 30.0 * l.glitch * (-u * 7.0).exp()) * (1.0 + phase.white) * s.width / 1920.0;
        let kick = 1.0
            + 0.1 * (-u * 18.0).exp() * (u * std::f64::consts::TAU * 2.4).cos()
            + 0.03 * u.min(0.5);
        let jy = (if sample % 2 == 1 { 1.0 } else { -1.0 }) * 3.0 * l.glitch * s.height / 1080.0;
        for p in &l.parts {
            let [x, y] = s.point(p.position);
            for (i, position) in [[x - split, y + jy], [x, y], [x + split * 0.8, y - jy]]
                .into_iter()
                .enumerate()
            {
                result.text.push(plan::Text {
                    font: a.font.clone(),
                    text: p.text.clone(),
                    position,
                    font_size: (p.font_size * s.height * kick).round(),
                    tracking: 0.0,
                    color: a.rgb_colors[i],
                    opacity: 1.0,
                    blur: 0.0,
                });
            }
        }
        if let Some(frame) = &l.frame {
            result.frame = Some(plan::Frame {
                rect: s.rect(frame.rect),
                color: frame.color,
                width: frame.width * s.height,
            });
            result.indicator = Some(plan::Rect {
                rect: s.rect(frame.indicator.rect),
                color: frame.indicator.color,
                opacity: 1.0,
            });
        }
        let scale = s.height / 1080.0;
        for y in (sample % 3..1080).step_by(3) {
            result.erasers.push(plan::Eraser {
                rect: [0.0, y as f64 * scale, s.width, scale],
                opacity: a.scanline_opacity,
            });
        }
        (result.bands, result.blocks) = glitch::bands_and_blocks(a, l, s, flick, sample);
        result.kick_glow = l.kick_glow.as_ref().map(|g| finishing::kick(g, s, u));
    } else {
        let y = ((s.elapsed() * 0.7).fract() * 1080.0).floor() * s.height / 1080.0;
        result.idle_scan = Some(plan::Rect {
            rect: [0.0, y, s.width, 2.0 * s.height / 1080.0],
            color: a.idle_scan_color,
            opacity: 1.0,
        });
    }
    let (flood, white, negative) = finishing::flood(a, s, phase.white);
    Ok(plan::Plan {
        mode: "flicker",
        background: a.background,
        quiet: None,
        flicker: Some(result),
        grain: math::grain(s.seed, s.song_ticks * 24 / 120_000, a.grain),
        flood,
        white,
        negative,
    })
}
