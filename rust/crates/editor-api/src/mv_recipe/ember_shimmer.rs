use super::{draw::Draw, light, math::*, model::Palette, plan::Command};

pub(super) fn draw(d: &mut Draw, x: f64, y: f64, intensity: f64, t: f64, streak: f64, p: &Palette) {
    // Buffer coordinates are physical 1600x900 pixels, not output-scaled design units.
    let mut buffer = Draw::new(1920.0, 1080.0);
    light::ember(&mut buffer, 800.0, 520.0, intensity, t, streak, p);
    d.commands.push(Command::Surface {
        id: "ember-shimmer",
        size: [1600, 900],
        commands: buffer.commands,
    });
    let amplitude = 1.2 + 3.2 * intensity.min(1.2);
    for yy in (0..900).step_by(4) {
        let row = yy as f64;
        let above = 534.0 - row;
        let m = clamp(above / 40.0) * (1.0 - clamp((above - 40.0) / 520.0)) + 0.12;
        let dx = amplitude
            * m
            * ((row * 0.071 + t * 7.3).sin()
                + 0.55 * (row * 0.183 - t * 11.9 + 1.7).sin()
                + 0.3 * noise(row * 0.05 + t * 3.0, 9.0));
        d.commands.push(Command::Blit {
            surface: "ember-shimmer",
            source_rect: [0.0, row, 1600.0, 4.0],
            destination_rect: [x - 800.0 + dx, y - 520.0 + row, 1600.0, 4.0],
            transform: d.identity(),
            operations: d.operations.clone(),
            composite: "lighter",
            opacity: 1.0,
            clip: None,
            raster: None,
        });
    }
}
