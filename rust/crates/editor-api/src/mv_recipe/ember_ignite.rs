use super::{
    Sample,
    clock::{self, Envelope, seconds},
    cracks,
    draw::*,
    ease::*,
    grain, hud, light,
    math::*,
    model::{BlackFrom, Ignite},
    particles::{self, Burst, Sparks},
    plan::Operation,
};

pub(super) fn draw(d: &mut Draw, a: &Ignite, s: &Sample<'_>) -> Result<(), String> {
    let t = seconds(s.song_ticks);
    let start = seconds(s.shot_start_ticks);
    let end = seconds(s.shot_end_ticks);
    let all = clock::beats(&a.beats, s)?;
    let env = Envelope::sample(s)?;
    let metrics = s.fonts.ok_or("Ember HUD requires measured font advances")?;
    let black = match a.black_from {
        BlackFrom::LastBeat {} => clock::last_before(&all, end),
        BlackFrom::At { song_ticks } => seconds(song_ticks),
    };
    d.background(a.palette.background);
    if t >= black || clock::in_stops(&a.stops_ticks, t) {
        return Ok(());
    }
    let beats: Vec<_> = clock::from(&all, start, 12)
        .into_iter()
        .filter(|b| *b < black - 0.02)
        .collect();
    let crack = seconds(a.crack_at_ticks);
    let build = inv(start, black, t);
    let rise = inv(crack, black, t);
    let ignition = seg(t, start, 0.6);
    let pulse = clock::pulse(&all, t, 9.0);
    let p = &a.palette;
    let r = a.ring * out(ignition) * (1.0 + 0.14 * (build * build)) * (1.0 + 0.03 * pulse);
    let zoom = 1.0 + 0.09 * (build * build) + 0.012 * pulse + 0.04 * hit(t, start, 6.0);
    let shake = 7.0 * env.rms * rise + 16.0 * hit(t, start, 9.0);
    let q = (t * 24.0).floor();
    let intensity =
        0.55 + 0.3 * env.rms + 0.2 * env.low + 0.9 * hit(t, start, 4.0) + 0.3 * pulse + 0.35 * rise;
    d.glow(
        960.0,
        540.0,
        1100.0,
        &[
            (0.0, rgba(p.aura, 0.5 + 0.3 * build)),
            (1.0, rgba(p.aura, 0.0)),
        ],
        "source-over",
    );
    d.operations = vec![
        Operation::Translate {
            offset: [960.0 + rnds(q, 5.0) * shake, 540.0 + rnds(q, 12.0) * shake],
        },
        Operation::Scale {
            factors: [zoom, zoom],
        },
        Operation::Translate {
            offset: [-960.0, -540.0],
        },
    ];
    for (mult, alpha) in [(1.45, 0.1), (1.95, 0.07), (2.7, 0.05)] {
        d.path(
            circle(960.0, 540.0, r * mult),
            vec![stroke(
                solid(rgba(
                    p.glow,
                    (alpha + 0.18 * pulse) * out(seg(t, start + 0.15 * mult, 0.6)),
                )),
                1.0,
                "butt",
                "miter",
            )],
        );
    }
    let dt = t - start;
    if (0.0..0.9).contains(&dt) {
        let e = out(dt / 0.9);
        d.path(
            circle(960.0, 540.0, 40.0 + 1100.0 * e),
            vec![stroke(
                solid(rgba(p.hi, 0.7 * (1.0 - e))),
                2.0 + 10.0 * (1.0 - e),
                "butt",
                "miter",
            )],
        );
    }
    for beat in &beats {
        let dt = t - beat;
        if !(0.0..=1.3).contains(&dt) {
            continue;
        }
        let e = out(dt / 1.3);
        d.path(
            circle(960.0, 540.0, r + 30.0 + 680.0 * e),
            vec![stroke(
                solid(rgba(p.glow, 0.55 * (1.0 - e) * (1.0 - e))),
                1.0 + 2.5 * (1.0 - e),
                "butt",
                "miter",
            )],
        );
    }
    if t >= crack {
        let levels = [110.0, 330.0, 720.0, 1250.0];
        let (mut front, mut snap) = (0.0_f64, 0.0_f64);
        for (i, beat) in beats.iter().filter(|b| **b >= crack - 0.02).enumerate() {
            if t >= *beat {
                front = lerp(
                    if i > 0 { levels[(i - 1).min(3)] } else { 0.0 },
                    levels[i.min(3)],
                    out(seg(t, *beat, 0.16)),
                );
                snap = snap.max(hit(t, *beat, 9.0));
            }
        }
        front += 45.0 * (t - crack);
        cracks::draw(
            d,
            f64::from(if a.seed == 0 { 5 } else { a.seed }),
            jsround(a.ring * 1.02),
            front,
            0.75 + 0.8 * snap,
            p,
        );
    }
    let pre = 1.0 - ignition;
    light::ember(
        d,
        960.0,
        540.0,
        0.25 + 0.35 * (1.0 - ignition) + 2.6 * hit(t, start, 7.0) + 0.2 * pulse,
        t,
        1400.0 * hit(t, start, 5.0),
        p,
    );
    light::fire_ring(
        d,
        960.0,
        540.0,
        r,
        intensity * (ignition * 4.0).min(1.0),
        t,
        p,
        1.0,
        0.45,
    );
    if pre > 0.0 {
        let alpha = 0.7 * pre;
        d.glow(
            960.0,
            540.0,
            260.0 * pre + 60.0,
            &[
                (0.0, rgba(p.hi, alpha)),
                (0.25, rgba(p.hi, alpha * 0.45)),
                (1.0, rgba(p.hi, 0.0)),
            ],
            "lighter",
        );
    }
    particles::burst(
        d,
        t,
        start,
        Burst {
            x: 960.0,
            y: 540.0,
            ring: 40.0,
            n: 48,
            seed: 61.0,
            speed: 1500.0,
            life: 1.4,
            gravity: 120.0,
            drag: 3.2,
        },
        p,
    );
    for (i, beat) in beats.iter().enumerate().skip(1) {
        particles::burst(
            d,
            t,
            *beat,
            Burst {
                x: 960.0,
                y: 540.0,
                ring: r,
                n: 14,
                seed: 70.0 + i as f64,
                speed: 520.0,
                life: 0.8,
                gravity: 160.0,
                drag: 3.2,
            },
            p,
        );
    }
    particles::sparks(
        d,
        t,
        Sparks {
            x: 960.0,
            y: 540.0 - r * 0.2,
            n: 18,
            seed: 8.0,
            spread: r * 1.6,
            alpha: 0.7,
            rise: 1.4,
        },
        p,
    );
    d.operations.clear();
    grain::draw(d, t, a.grain);
    hud::draw(
        d,
        &a.hud,
        t,
        clamp(intensity * 0.7),
        clock::pulse(&all, t, 7.0),
        p,
        metrics,
    )
}
