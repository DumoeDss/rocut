use super::*;
pub fn chips(
    d: &mut Draw,
    session: &Session,
    offset: [f64; 2],
    impact: [f64; 2],
    tq: f64,
    c: &Timing,
) {
    for (k, (chip, image)) in session
        .body
        .chips
        .iter()
        .zip(&session.chip_images)
        .enumerate()
    {
        let phase = k as f64 * 1.9;
        let mut x = offset[0] + chip.center[0] + 6.0 * (tq * 1.3 + phase).sin();
        let mut y = offset[1] + chip.center[1] + 7.0 * (tq * 1.1 + phase).cos();
        let mut rotation = 0.2 * (tq * 0.9 + phase).sin();
        if c.broken {
            let dx = x - impact[0];
            let dy = y - impact[1];
            let dd = dx.hypot(dy);
            let dd = if dd == 0.0 { 1.0 } else { dd };
            let r = 160.0 * burst(c.tau, 0.1) + 90.0 * c.tau;
            x += dx / dd * r;
            y += dy / dd * r + 20.0 * c.tau * c.tau;
            rotation += 2.0 * burst(c.tau, 0.2) * if k % 2 != 0 { 1.0 } else { -1.0 };
        }
        let size = [chip.display_size[0] as u32, chip.display_size[1] as u32];
        let id = d.surface_id("heart-chip");
        d.commands.push(Command::Heart(HeartCommand::OwnedSurface {
            id: id.clone(),
            size,
            commands: vec![Command::Heart(HeartCommand::PreparedImage {
                image: image.clone(),
                source_rect: None,
                destination_rect: [0.0, 0.0, size[0] as f64, size[1] as f64],
                transform: ID,
                operations: Vec::new(),
                clip: None,
                composite: "source-over",
                opacity: 1.0,
                smoothing: true,
                smoothing_quality: "low",
            })],
        }));
        let saved = d.operations.clone();
        d.operations.push(Operation::Translate { offset: [x, y] });
        d.operations.push(Operation::Rotate { radians: rotation });
        d.blit_owned(
            &id,
            size,
            [
                -(size[0] as f64) / 2.0,
                -(size[1] as f64) / 2.0,
                size[0] as f64,
                size[1] as f64,
            ],
            1.0,
            "source-over",
        );
        d.operations = saved;
        d.commands
            .push(Command::Heart(HeartCommand::OwnedReleaseSurface {
                surface: id,
            }));
    }
}
