use super::{
    draw::*,
    gather_motion::{self, Arrival},
    rebirth_draw::*,
    Session,
};
pub fn shards(
    d: &mut Draw,
    session: &Session,
    arrivals: &[Arrival],
    t: f64,
    chest: [f64; 2],
    hand: [f64; 2],
    ff: bool,
) -> Result<(), String> {
    for q in arrivals {
        let s = &session.glass.shards[q.shard];
        let f = gather_motion::flight(q, t, chest, hand, s.glow_phase, ff);
        let [x, y] = f.position;
        if t < q.at {
            if f.progress > 0.01 {
                trail(
                    d,
                    &f.trail,
                    if ff { FF } else { GLOW },
                    if ff { 9.0 } else { 7.0 } * (0.6 + 0.4 * f.scale),
                    0.55 * (f.progress * 5.0).min(1.0),
                    if ff { FF_CORE } else { HOT },
                );
            }
            if f.glass > 0.01 {
                piece(
                    d,
                    session,
                    s,
                    super::sprites::Variant::Base,
                    [x, y],
                    f.spin,
                    f.flip,
                    f.scale,
                    f.glass,
                    "source-over",
                )?;
                piece(
                    d,
                    session,
                    s,
                    super::sprites::Variant::Glow,
                    [x, y],
                    f.spin,
                    f.flip,
                    f.scale,
                    f.glass * (0.45 + 0.55 * f.eased + f.glint),
                    "lighter",
                )?;
                if f.glint > 0.5 {
                    d.sparkle(
                        x,
                        y,
                        22.0 * f.glint * f.scale + 4.0,
                        f.glint * 0.8,
                        0.3,
                        true,
                    );
                }
            }
            if f.firefly > 0.01 {
                let bl = 0.75 + 0.25 * (t * 9.0 + q.k as f64).sin();
                d.glow(x, y, 34.0 * f.scale + 12.0, FF, f.firefly * 0.55 * bl);
                d.glow(x, y, 7.0, FF_CORE, f.firefly * bl);
            }
        } else if ff {
            let (p, bl) = gather_motion::landed_firefly(q, t, f.target);
            d.glow(p[0], p[1], 30.0, FF, 0.5 * bl);
            d.glow(p[0], p[1], 6.0, FF_CORE, bl);
        }
        let dl = t - q.at;
        if dl >= 0.0 && dl < 0.5 {
            let k = dl / 0.5;
            let big = q.k < 5;
            let [x, y] = f.target;
            d.sparkle_color(
                x,
                y,
                if big { 80.0 } else { 40.0 } * out_back((dl / 0.12).min(1.0), 1.70158) * (1.0 - k),
                1.0 - k,
                if ff { FF_CORE } else { HOT },
                0.785 * (q.k % 2) as f64,
                true,
            );
            d.ring(
                x,
                y,
                12.0 + if big { 90.0 } else { 50.0 } * out_expo(k),
                2.2 * (1.0 - k),
                if ff { FF } else { HI },
                0.8 * (1.0 - k),
            );
            for j in 0..6 {
                let an = j as f64 / 6.0 * std::f64::consts::TAU + q.random * 3.0;
                let r = 70.0 * burst(dl, 0.1);
                d.sparkle_color(
                    x + an.cos() * r,
                    y + an.sin() * r + 40.0 * dl * dl,
                    9.0 * (1.0 - k),
                    1.0 - k,
                    if ff { FF } else { HI },
                    an,
                    false,
                );
            }
        }
    }
    Ok(())
}
