use super::plan::Operation;
use super::{
    clock::Clock,
    ease::{ease, hit, sine},
    math::*,
    model::{Easing, TitleRiff},
};

pub(super) struct State {
    pub x: f64,
    pub y: f64,
    pub radius: f64,
    pub lock: f64,
    pub exit: f64,
    pub zoom: f64,
    pub shake: [f64; 2],
    pub camera: Vec<Operation>,
}
impl State {
    pub fn new(a: &TitleRiff, c: &Clock) -> Self {
        let t = c.time;
        let at = |k| c.at(k);
        let q = a.cues;
        let lock = ease(seg(t, at(q.lock) - 0.02, 0.5), Easing::Io);
        let exit = if !a.exit {
            0.0
        } else {
            ease(
                seg(t, at(q.exit) + 0.05, c.end - at(q.exit) - 0.05),
                Easing::In,
            )
        };
        let sun_in = ease(seg(t, at(q.sun), 0.5), Easing::Out);
        let mut radius = lerp(250.0, 218.0, lock);
        radius *= if a.outro() {
            sun_in
        } else {
            lerp(176.0 / 250.0, 1.0, sun_in)
        };
        radius *= 1.0 + 0.02 * c.pulse;
        let z = ease(seg(t, at(q.zan) - 0.03, 0.34), Easing::Whip);
        let k = ease(seg(t, at(q.ko) - 0.03, 0.34), Easing::Whip);
        let home = ease(seg(t, at(q.split) - 0.04, 0.42), Easing::Io);
        let x = lerp(960.0 + 330.0 * z - 660.0 * k, 960.0, home);
        let y = lerp(540.0, 500.0, lock);
        let silhouette = if q.sil >= 0 {
            sine(seg(t, at(q.sil), at(q.lock) - at(q.sil)))
        } else {
            0.0
        };
        let mut zoom = 1.0 + 0.2 * silhouette * (1.0 - lock) + 0.012 * c.pulse;
        let mut shake = 10.0 * hit(t, at(q.lock), 8.0) + 12.0 * hit(t, at(q.sun), 8.0);
        for cue in [q.zan, q.ko] {
            let at = at(cue);
            shake += 22.0 * hit(t, at, 9.0);
            zoom *= 1.0 - 0.03 * clamp((t - (at - 0.07)) / 0.07) * if t < at { 1.0 } else { 0.0 };
        }
        let shake = [
            rnds((t * 24.0).floor(), 17.0) * shake,
            rnds((t * 24.0).floor(), 24.0) * shake,
        ];
        let camera = vec![
            Operation::Translate {
                offset: [x + shake[0], y + shake[1]],
            },
            Operation::Scale {
                factors: [zoom, zoom],
            },
            Operation::Translate { offset: [-x, -y] },
        ];
        Self {
            x,
            y,
            radius,
            lock,
            exit,
            zoom,
            shake,
            camera,
        }
    }
}
