use super::{
    draw::*,
    plan::{Command, MemoryCommand, Operation, Plan},
    Session,
};
fn plan(d: Draw) -> Plan {
    Plan {
        commands: d.commands,
        raster_budget_bytes: 0,
    }
}
pub fn lut() -> Plan {
    let mut d = Draw::new();
    d.rect(
        [0.0, 0.0, 256.0, 1.0],
        fill(
            linear(
                [0.0, 0.0],
                [256.0, 0.0],
                &[
                    (0.0, color(36.0, 28.0, 26.0, 1.0)),
                    (0.2, color(74.0, 59.0, 53.0, 1.0)),
                    (0.45, color(125.0, 106.0, 94.0, 1.0)),
                    (0.68, color(183.0, 156.0, 139.0, 1.0)),
                    (0.85, color(216.0, 199.0, 174.0, 1.0)),
                    (1.0, color(239.0, 230.0, 214.0, 1.0)),
                ],
            ),
            "source-over",
        ),
    );
    plan(d)
}
pub fn composite(s: &Session, slot: usize) -> Result<Plan, String> {
    let p = s.photos.get(slot).ok_or("Memories photo slot missing")?;
    let source = &s.args.photos[p.index];
    let f = s
        .facts
        .images
        .iter()
        .find(|f| f.resource.id == source.bg)
        .ok_or("Memories image fact missing")?;
    let mut d = Draw::new();
    d.rect(
        [0.0, 0.0, 1040.0, 650.0],
        fill(solid(color(125.0, 106.0, 94.0, 1.0)), "source-over"),
    );
    let (x, y, zoom) = source
        .view
        .as_ref()
        .map(|v| (v.x, v.y, v.zoom.unwrap_or(1.0)))
        .unwrap_or(if p.face.is_some() {
            (0.1, 0.25, 1.12)
        } else {
            (0.0, 0.0, 1.08)
        });
    let zoom = if zoom == 0.0 { 1.0 } else { zoom };
    let scale = (1040.0 / f.width as f64).max(650.0 / f.height as f64) * zoom;
    let w = f.width as f64 * scale;
    let h = f.height as f64 * scale;
    d.image(
        &source.bg,
        [
            (1040.0 - w) / 2.0 + x * (w - 1040.0) / 2.0,
            (650.0 - h) / 2.0 + y * (h - 650.0) / 2.0,
            w,
            h,
        ],
    );
    if p.face.is_some() {
        let selection = super::model::select(&s.args)?;
        let id = selection
            .character
            .as_ref()
            .ok_or("Memories character source missing")?;
        let ch = s
            .facts
            .images
            .iter()
            .find(|f| &f.resource.id == id)
            .ok_or("Memories character native fact missing")?;
        let h = 650.0 * 1.42;
        let w = h * ch.width as f64 / ch.height as f64;
        let left = 1040.0 * 0.665 - 0.276 * w;
        let top = 650.0 * 0.3 - 0.122 * h;
        let mut paint = fill(solid(color(26.0, 15.0, 12.0, 1.0)), "source-over");
        paint.opacity = 0.28;
        d.commands
            .push(Command::Memories(MemoryCommand::FilteredPath {
                transform: ID,
                operations: Vec::new(),
                path: vec![super::plan::Step::Native(
                    super::plan::common::native::Step::Ellipse {
                        center: [left + w * 0.47, top + h * 0.99],
                        radii: [w * 0.3, 18.0],
                        rotation: 0.0,
                        start: 0.0,
                        end: std::f64::consts::TAU,
                        anticlockwise: false,
                    },
                )],
                paints: vec![paint],
                blur_px: 10.0,
            }));
        d.image(id, [left, top, w, h]);
    }
    Ok(plan(d))
}
pub fn desk(s: &Session) -> Result<(Plan, super::plan::Payload), String> {
    let payload = super::plan::raster(
        &s.binding,
        "desk-mottle".into(),
        [160, 90],
        super::grade::desk_mottle(s.args.seed.unwrap_or(45) as f64),
    )?;
    let mut d = Draw::new();
    d.rect(
        [0.0, 0.0, 1200.0, 675.0],
        fill(
            radial(
                [552.0, 324.0, 40.0],
                [600.0, 337.5, 840.0],
                &[
                    (0.0, color(52.0, 40.0, 42.0, 1.0)),
                    (0.5, color(36.0, 28.0, 26.0, 1.0)),
                    (1.0, color(16.0, 11.0, 11.0, 1.0)),
                ],
            ),
            "source-over",
        ),
    );
    d.surface(
        "memories-mottle",
        [160, 90],
        vec![Command::Memories(MemoryCommand::Pixels {
            raster: payload.raster.clone(),
        })],
    );
    d.blit(
        "memories-mottle",
        [160, 90],
        [0.0, 0.0, 1200.0, 675.0],
        0.55,
        "overlay",
        None,
        "high",
    );
    d.release("memories-mottle");
    Ok((plan(d), payload))
}
pub fn window() -> Vec<Command> {
    let mut d = Draw::new();
    d.operations.push(Operation::Translate {
        offset: [480.0 * 0.34, 270.0 * 0.46],
    });
    for r in 0..2 {
        for q in 0..3 {
            let x = -110.0 + q as f64 * 69.0;
            let y = -58.0 + r as f64 * 57.0;
            d.filtered_rect(
                [x, y, 64.0, 52.0],
                fill(
                    linear(
                        [x, y],
                        [x + 64.0 * 1.2, y + 52.0],
                        &[
                            (0.0, color(255.0, 222.0, 176.0, 1.0)),
                            (1.0, color(255.0, 196.0, 140.0, 0.72)),
                        ],
                    ),
                    "source-over",
                ),
                2.6,
                Some([1.0, 0.2, -0.62, 1.0, 0.0, 0.0]),
            );
        }
    }
    d.operations.clear();
    d.rect(
        [0.0, 0.0, 480.0, 270.0],
        fill(
            radial(
                [163.2, 124.2, 30.0],
                [163.2, 124.2, 201.6],
                &[(0.0, [0.0; 4]), (1.0, [0.0, 0.0, 0.0, 1.0])],
            ),
            "destination-out",
        ),
    );
    d.commands
}
