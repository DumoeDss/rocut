use super::{
    draw::*,
    sky::Session,
    sky_geometry::Piece,
    sky_sprites::{self, Variant},
};
pub fn falling(d: &mut Draw, p: &Piece, tau: f64) {
    let q = super::sky_motion::fall(
        super::sky_motion::FallInput {
            position: p.position,
            direction: p.direction,
            velocity: p.velocity,
            gravity: p.gravity,
            size: p.size,
            z: p.z,
            foreground: p.foreground,
            spin_velocity: p.spin_velocity,
            spin_acceleration: p.spin_acceleration,
            flip_velocity: p.flip_velocity,
            glow_phase: p.glow_phase,
        },
        tau,
    );
    if !q.visible {
        return;
    }
    sky_sprites::draw(
        d,
        p,
        Variant::Base,
        q.position,
        q.spin,
        q.flip,
        q.scale,
        0.94,
        "source-over",
    );
    sky_sprites::draw(
        d,
        p,
        Variant::Dark,
        q.position,
        q.spin,
        q.flip,
        q.scale,
        q.dark,
        "source-over",
    );
    sky_sprites::draw(
        d,
        p,
        Variant::Glow,
        q.position,
        q.spin,
        q.flip,
        q.scale,
        0.8 * decay(tau, 1.3) + 0.3 + q.glint * 0.8,
        "lighter",
    );
    if q.glint > 0.05 {
        sky_sprites::draw(
            d,
            p,
            Variant::Base,
            q.position,
            q.spin,
            q.flip,
            q.scale,
            q.glint * 0.45,
            "lighter",
        );
    }
    if q.glint > 0.45 {
        d.sparkle(
            q.position[0] - p.direction[0] * p.size * 0.3 * q.scale,
            q.position[1] - p.size * 0.25 * q.scale,
            24.0 + 40.0 * q.glint,
            q.glint,
            0.3,
            true,
        );
    }
}
pub fn debris(d: &mut Draw, session: &Session, releases: &[f64], t: f64) {
    for (p, tr) in session.pieces.iter().zip(releases) {
        let tau = t - tr;
        if tau < -0.1 || tau > 1.6 {
            continue;
        }
        for j in 0..7 {
            let q = super::sky_motion::debris(j, t, tau, p.position, p.size, p.jitter);
            let [x, y] = q.position;
            d.rect(
                [x - 1.2, y - 1.2, 2.4, 2.4],
                fill(
                    solid(alpha(if q.white { [1.0; 4] } else { HI }, q.alpha)),
                    "lighter",
                ),
            );
            if q.sparkle {
                d.sparkle(x, y, 12.0, q.alpha, 0.0, false);
            }
        }
    }
}
pub fn waiting(d: &mut Draw, p: &Piece, t: f64, tr: f64, crack: f64) {
    let lo = inv(tr - 0.42, tr, t).powi(2);
    let trem = lo * (t * 70.0 + p.jitter * 20.0).sin() * 1.6;
    let xy = [
        p.position[0] + p.direction[0] * 5.0 * lo + trem,
        p.position[1] + p.direction[1] * 5.0 * lo,
    ];
    sky_sprites::draw(
        d,
        p,
        Variant::Base,
        xy,
        0.012 * lo * if p.jitter < 0.5 { -1.0 } else { 1.0 },
        0.0,
        1.0,
        1.0,
        "source-over",
    );
    sky_sprites::draw(
        d,
        p,
        Variant::Glow,
        xy,
        0.0,
        0.0,
        1.0,
        (crack + 0.6 * lo) * (0.45 + 0.55 * p.near),
        "lighter",
    );
}
