use super::{
    clock::Clock,
    draw::*,
    fonts::label_request,
    labels::{self, Label},
    math::*,
    model::KanjiSlam,
    palette::*,
    plan::*,
    raster::*,
    state::State,
};
use crate::mv_font_metrics::Context;
fn label(d: &mut Draw, l: &Label, fonts: &Context) -> Result<(), String> {
    fonts.bounds(&l.font, &label_request(l))?;
    d.commands.push(Command::Text {
        font: l.font.clone(),
        text: l.text.clone(),
        font_size: l.size,
        tracking: 0.0,
        position: l.position,
        transform: I,
        operations: vec![],
        fill: TextFill::Color { color: l.color },
        opacity: 1.0,
        composite: "source-over",
        align: l.align,
        baseline: "middle",
    });
    Ok(())
}
pub(super) fn draw(
    d: &mut Draw,
    a: &KanjiSlam,
    c: &Clock,
    s: &State,
    fonts: &Context,
) -> Result<(), String> {
    let (labels, y) = labels::labels(a, c);
    for l in &labels[..labels.len() - 1] {
        label(d, l, fonts)?;
    }
    d.rect(
        [85.5, y + 8.0, 1.0, 90.0],
        fill(
            solid([244.0 / 255.0, 239.0 / 255.0, 230.0 / 255.0, 0.5]),
            "source-over",
        ),
    );
    label(d, labels.last().expect("counter"), fonts)?;
    let g = s.glyphs.last().expect("word");
    if c.hit == 0 && !a.no_flash {
        d.rect(
            FRAME,
            opacity(
                fill(solid(rgb(0xfff4dc)), "source-over"),
                0.95 * (-c.elapsed * 11.0).exp(),
            ),
        );
    } else if !s.rekick {
        glow(d, g.x, g.y, 1100.0, HI, 0.3 * (-c.elapsed * 14.0).exp());
    }
    d.rect(FRAME, fill(vignette(a), "source-over"));
    let mut rng = Rng::new(4242.0);
    let gray = (0..65536)
        .map(|_| ((rng.next() * 0.6 + rng.next() * 0.4) * 255.0).floor() as u8)
        .collect();
    let f = frame(c.time, 24.0);
    d.commands.push(Command::Grain {
        transform: [
            1.0,
            0.0,
            0.0,
            1.0,
            -(rnd(f, 1.0) * 256.0).floor(),
            -(rnd(f, 2.0) * 256.0).floor(),
        ],
        rect: [0.0, 0.0, 2176.0, 1336.0],
        size: [256, 256],
        gray,
        opacity: 0.1,
        // Original filmGrain inherits the vignette's gradient assignment.
        // Per-command isolation must replay that history before the pattern.
        fill_history: Some(FillHistory {
            transform: d.identity(),
            style: vignette(a),
        }),
    });
    Ok(())
}

fn vignette(a: &KanjiSlam) -> Style {
    Style::Radial {
        from: [960.0, 540.0, 1080.0 * 0.35],
        to: [960.0, 540.0, 1080.0 * 1.05],
        stops: stops(&[
            (0.0, [0.0; 4]),
            (
                1.0,
                if a.night() {
                    rgba(rgb(0x02040c), 0.6)
                } else if a.fire {
                    rgba(rgb(0x0a0204), 0.6)
                } else {
                    rgba(rgb(0x140610), 0.45)
                },
            ),
        ]),
    }
}
