use super::{
    Photo, Session,
    draw::*,
    plan::{Command, MemoryCommand, Operation, Payload},
};
pub fn live(
    d: &mut Draw,
    s: &Session,
    p: &Photo,
    slot: usize,
    cap: f64,
    b: f64,
    t: f64,
    payloads: &mut Vec<Payload>,
) -> Result<(), String> {
    let base = p
        .base
        .as_ref()
        .ok_or("Memories photo base is not prepared")?;
    if b > -0.5 {
        let buffers = super::field::render(&p.field, b, t).map_err(str::to_owned)?;
        for (id, part, rgba) in [
            ("memories-keep", "keep", buffers.keep),
            ("memories-over", "over", buffers.over),
            ("memories-glow", "glow", buffers.glow),
        ] {
            let payload = super::plan::raster(
                &s.binding,
                format!("photo-{slot}-{part}-{:016x}", t.to_bits()),
                [320, 246],
                rgba,
            )?;
            d.surface(
                id,
                [320, 246],
                vec![Command::Memories(MemoryCommand::Pixels {
                    raster: payload.raster.clone(),
                })],
            );
            payloads.push(payload);
        }
        let mut halo = Draw::new();
        halo.blit(
            "memories-glow",
            [320, 246],
            [0.0, 0.0, 160.0, 123.0],
            1.0,
            "source-over",
            Some(3.0),
            "low",
        );
        d.surface("memories-halo", [160, 123], halo.commands);
    }
    let mut live = Draw::new();
    live.prepared(
        &base.raster,
        [0.0, 0.0, 1120.0, 862.0],
        1.0,
        "source-over",
        "low",
    );
    live.operations.push(Operation::Scale {
        factors: [2.0, 2.0],
    });
    super::caption::draw(&mut live, s, p, cap)?;
    live.operations.clear();
    if b > -0.5 {
        live.blit(
            "memories-keep",
            [320, 246],
            [0.0, 0.0, 1120.0, 862.0],
            1.0,
            "destination-in",
            None,
            "high",
        );
        live.blit(
            "memories-over",
            [320, 246],
            [0.0, 0.0, 1120.0, 862.0],
            1.0,
            "source-atop",
            None,
            "high",
        );
    }
    d.surface("memories-live", [1120, 862], live.commands);
    Ok(())
}
pub fn release(d: &mut Draw, b: f64) {
    d.release("memories-live");
    if b > -0.5 {
        for id in [
            "memories-keep",
            "memories-over",
            "memories-glow",
            "memories-halo",
        ] {
            d.release(id);
        }
    }
}
