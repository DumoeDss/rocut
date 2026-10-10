use super::{draw::*, rebirth_draw::*, Session};
pub fn particles(
    d: &mut Draw,
    session: &Session,
    t: f64,
    tq: f64,
    t0: f64,
    tf: f64,
    tau: f64,
    center: [f64; 2],
    radius: f64,
) -> Result<(), String> {
    if tau < 0.06 {
        for i in 0..260 {
            let q = super::sun_motion::vortex(i, t, t0, tf, center);
            if q.position[2] >= 1.0 {
                continue;
            }
            let c = rgb(q.color[0], q.color[1], q.color[2], 1.0);
            d.path(
                vec![
                    mv([q.previous[0], q.previous[1]]),
                    ln([q.position[0], q.position[1]]),
                ],
                vec![stroke(
                    alpha(c, q.alpha),
                    q.width,
                    "lighter",
                    "round",
                    "miter",
                )],
            );
            if let Some(r) = q.glow_radius {
                d.glow(q.position[0], q.position[1], r, c, q.alpha * 0.7);
            }
        }
        let mut shards: Vec<_> = session.glass.shards.iter().collect();
        shards.sort_by(|a, b| b.coverage.total_cmp(&a.coverage));
        shards.truncate(18);
        for (i, s) in shards.into_iter().enumerate() {
            let q = super::sun_motion::shard(i, t, tq, t0, tf, center);
            if q.position[2] >= 1.0 {
                continue;
            }
            let p = [q.position[0], q.position[1]];
            piece(
                d,
                session,
                s,
                super::sprites::Variant::Char,
                p,
                q.spin,
                q.flip,
                q.scale,
                1.0,
                "source-over",
            )?;
            piece(
                d,
                session,
                s,
                super::sprites::Variant::Flame,
                p,
                q.spin,
                q.flip,
                q.scale,
                q.flame_alpha,
                "lighter",
            )?;
            d.tongues(
                p[0],
                p[1] - s.size * 0.2 * q.scale,
                s.size * 0.8 * q.scale,
                tq,
                i as f64 * 7.3,
                0.7,
                2,
            );
        }
    }
    if tau >= 0.0 {
        for i in 0..120 {
            let s = super::sun_motion::spark(i, t, tau, radius, center);
            d.rect(
                s.rect,
                fill(
                    solid(alpha(if s.high { HI } else { GLOW }, s.alpha)),
                    "lighter",
                ),
            );
        }
    }
    Ok(())
}
