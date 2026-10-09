use super::{
    draw::*,
    ease::jsround,
    math::clamp,
    model::{Hud, Palette},
    plan::{Command, TextFill},
};
use crate::mv_font_metrics::Context;

pub(super) fn plain(value: &str) -> String {
    value.replace('Ō', "O").replace('ō', "o")
}
fn text(
    d: &mut Draw,
    hud: &Hud,
    value: String,
    position: [f64; 2],
    size: f64,
    color: crate::mv_recipe::model::Color,
    opacity: f64,
) {
    d.commands.push(Command::Text {
        font: hud.font.clone(),
        text: value,
        font_size: size,
        tracking: 0.0,
        position,
        transform: d.identity(),
        operations: d.operations.clone(),
        fill: TextFill::Color { color },
        opacity,
        composite: "source-over",
        align: "left",
        baseline: "alphabetic",
    });
}
pub(super) fn draw(
    d: &mut Draw,
    hud: &Hud,
    t: f64,
    level: f64,
    pulse: f64,
    p: &Palette,
    metrics: &Context,
) -> Result<(), String> {
    let count = ((t - 0.62) * 8.5).clamp(0.0, 99.0);
    let n = count.floor() as usize;
    let shown: String = hud.title.chars().take(n).collect();
    let normalized = plain(&shown);
    let width = metrics.advance(&hud.font, &normalized, 22.0, 0.0)?;
    text(d, hud, normalized, [96.0, 972.0], 22.0, p.glow, 0.9);
    let mut prefix = String::new();
    for character in shown.chars() {
        if character == 'Ō' {
            let pre = metrics.advance(&hud.font, &prefix, 22.0, 0.0)?;
            let cw = metrics.advance(&hud.font, "O", 22.0, 0.0)?;
            let mut paint = fill(solid(p.glow), "source-over");
            paint.opacity = 0.9;
            d.rect(
                [
                    jsround(96.0 + pre + cw * 0.2),
                    jsround(972.0 - 22.0 * 0.96),
                    jsround(cw * 0.6),
                    2.0,
                ],
                paint,
            );
        }
        prefix.push(match character {
            'Ō' => 'O',
            'ō' => 'o',
            other => other,
        });
    }
    let typing = n < hud.title.chars().count();
    if t > 0.3 && (typing || (t * 2.4).floor() as u64 % 2 == 0) {
        d.rect(
            [
                jsround(96.0 + width + if n > 0 { 6.0 } else { 0.0 }),
                954.0,
                10.0,
                20.0,
            ],
            fill(solid(rgba(p.glow, 0.85)), "source-over"),
        );
    }
    if t > 1.0 {
        let ca = clamp((t - 1.0) * 4.0);
        let seconds = (t.max(0.0) + 1e-6).floor() as u64;
        let frame = ((t.max(0.0) * f64::from(hud.clock.fps) + 1e-6) % f64::from(hud.clock.fps))
            .floor() as u64;
        let clock = format!(
            "{:02}:{:02}:{:02}.{:02}",
            hud.clock.hour,
            u64::from(hud.clock.minute) + seconds / 60,
            seconds % 60,
            frame
        );
        text(d, hud, clock, [96.0, 1002.0], 18.0, p.hi, 0.55 * ca);
        d.path(
            circle(268.0, 996.0, 3.5),
            vec![fill(
                solid(rgba(p.verm, (0.35 + 0.65 * pulse) * ca)),
                "source-over",
            )],
        );
        for i in 0..12 {
            let lit = level * 12.0 > i as f64 + 0.5;
            d.rect(
                [96.0 + i as f64 * 9.0, 1016.0, 6.0, 6.0],
                fill(
                    solid(rgba(
                        if i > 8 { p.hi } else { p.glow },
                        if lit { 0.85 * ca } else { 0.14 * ca },
                    )),
                    "source-over",
                ),
            );
        }
    }
    Ok(())
}
