use super::{
    Sample,
    clock::{self, Envelope, seconds},
    draw::*,
    ease::*,
    grain, hud,
    math::*,
    model::Breathe,
    particles::{self, Burst, Sparks},
    shimmer,
};

pub(super) fn draw(d: &mut Draw, a: &Breathe, s: &Sample<'_>) -> Result<(), String> {
    let t = seconds(s.song_ticks);
    let all = clock::beats(&a.beats, s)?;
    let env = Envelope::sample(s)?;
    let metrics = s.fonts.ok_or("Ember HUD requires measured font advances")?;
    d.background(a.palette.background);
    if clock::in_stops(&a.stops_ticks, t) {
        return Ok(());
    }
    // Reference uses song time, not t-shotStart when shotStart is positive.
    let fade = sine(inv(0.12, 1.25, t - seconds(s.shot_start_ticks).min(0.0)));
    let breath = 0.5 - 0.5 * ((t - 0.35) * TAU / 2.8).cos();
    let mut flare = 0.0_f64;
    for [start, end] in &a.flares_ticks {
        let (start, end) = (seconds(*start), seconds(*end));
        flare = flare.max(
            clamp((t - start) / 0.05)
                * if t < end {
                    1.0
                } else {
                    (-(t - end) * 7.0).exp()
                },
        );
    }
    let chop = if rnd((t * 16.0 + 1e-6).floor(), 7.0) > 0.3 {
        1.0
    } else {
        0.35
    };
    let relight = a
        .stops_ticks
        .iter()
        .map(|[_, end]| hit(t, seconds(*end), 14.0))
        .fold(0.0_f64, f64::max);
    let intensity = fade
        * (0.2
            + 0.14 * breath
            + 0.42 * env.mid
            + 0.45 * env.rms
            + 0.22 * env.low
            + 0.2 * env.vocal
            + 0.85 * flare * chop
            + 0.5 * relight);
    let x = 960.0 + 3.0 * noise(t * 0.7, 21.0);
    let y = 540.0 + 2.5 * noise(t * 0.6, 22.0);
    let p = &a.palette;
    d.glow(
        960.0,
        540.0,
        900.0,
        &[(0.0, rgba(p.aura, 0.55 * fade)), (1.0, rgba(p.aura, 0.0))],
        "source-over",
    );
    for at in &a.thumps_ticks {
        let dt = t - seconds(*at);
        if dt > 0.0 && dt < 1.2 {
            let e = out(dt / 1.2);
            d.path(
                circle(x, y, 12.0 + 520.0 * e),
                vec![stroke(
                    solid(rgba(p.glow, 0.22 * (1.0 - e) * (1.0 - e))),
                    1.2,
                    "butt",
                    "miter",
                )],
            );
        }
    }
    shimmer::draw(
        d,
        x,
        y,
        intensity,
        t,
        (90.0 + 260.0 * env.rms) * fade + 820.0 * flare * chop + 380.0 * relight,
        p,
    );
    particles::sparks(
        d,
        t,
        Sparks {
            x,
            y: y - 4.0,
            n: 9,
            seed: 4.0,
            alpha: clamp(intensity * 1.3) * fade,
            spread: 10.0,
            rise: 1.0,
        },
        p,
    );
    for [start, _] in &a.flares_ticks {
        let start = seconds(*start);
        particles::burst(
            d,
            t,
            start,
            Burst {
                x,
                y,
                n: 16,
                seed: jsround(start * 10.0),
                speed: 420.0,
                life: 0.9,
                gravity: -30.0,
                drag: 3.5,
                ring: 0.0,
            },
            p,
        );
    }
    grain::draw(d, t, a.grain);
    hud::draw(
        d,
        &a.hud,
        t,
        clamp(intensity),
        clock::pulse(&all, t, 7.0),
        p,
        metrics,
    )
}
