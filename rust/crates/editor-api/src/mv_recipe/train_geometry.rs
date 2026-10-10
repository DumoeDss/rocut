use super::{
    math::*,
    model::{Sample, Settings},
};
pub const P: f64 = 1560.0;
pub const G: f64 = 66.0;
pub const R: f64 = 468.0;
pub const WH: f64 = 212.0;
#[derive(Clone)]
pub struct Element {
    pub kind: &'static str,
    pub u0: f64,
    pub u1: f64,
    pub car: usize,
    pub window: Option<usize>,
}
pub struct Car {
    pub i: usize,
    pub u0: f64,
    pub u1: f64,
    pub elements: Vec<Element>,
}
pub struct Content {
    pub character: Option<String>,
    pub crop: Option<[f64; 4]>,
    pub seed: f64,
    pub hero: bool,
}
pub struct Geometry {
    pub cars: Vec<Car>,
    pub windows: Vec<Element>,
    pub contents: Vec<Content>,
    pub length: f64,
    pub freeze: [f64; 2],
    pub exit_at: f64,
    pub velocity: f64,
    pub shift: f64,
    pub best: Option<usize>,
}
pub fn time(t: f64, freeze: [f64; 2]) -> f64 {
    t - sat((t - freeze[0]) / (freeze[1] - freeze[0]).max(1e-6)) * (freeze[1] - freeze[0])
}
impl Geometry {
    pub fn front(&self, t: f64) -> f64 {
        W + self.length
            + self.velocity * (time(t, self.freeze) - time(self.exit_at, self.freeze))
            + self.shift
    }
    pub fn occupied(&self, xf: f64, x: f64) -> bool {
        let u = xf - x;
        if u < 0.0 || u > self.length {
            return false;
        }
        u - (u / P).floor() * P <= P - G
    }
}
pub fn crop(path: &str, index: usize) -> Option<[f64; 4]> {
    let pair = match path {
        "assets/char/bust_sing.png" => [[300.0, 150.0, 520.0, 420.0], [160.0, 60.0, 900.0, 560.0]],
        "assets/char/bust_calm.png" => [[210.0, 150.0, 500.0, 390.0], [80.0, 40.0, 900.0, 600.0]],
        "assets/char/eyes_ecu.png" => [[360.0, 300.0, 900.0, 520.0], [250.0, 150.0, 1180.0, 700.0]],
        "assets/char/smile_dawn.png" => [[300.0, 120.0, 520.0, 440.0], [160.0, 40.0, 900.0, 620.0]],
        _ => return None,
    };
    Some(pair[index % 2])
}
pub fn build(a: &Settings, s: &Sample<'_>) -> Result<Geometry, String> {
    let n = a.cars.unwrap_or(4);
    let mut cars = Vec::new();
    let mut windows = Vec::new();
    for i in 0..n {
        let mut u = i as f64 * P;
        let front = [
            ("nose", 176.0),
            ("gap", 30.0),
            ("cab", 150.0),
            ("gap", 40.0),
            ("door", 196.0),
            ("gap", 34.0),
            ("win", 250.0),
            ("gap", 28.0),
            ("win", 250.0),
            ("gap", 34.0),
            ("door", 196.0),
            ("gap", 34.0),
            ("win", 150.0),
        ];
        let other = [
            ("gap", 46.0),
            ("win", 250.0),
            ("gap", 34.0),
            ("door", 196.0),
            ("gap", 34.0),
            ("win", 250.0),
            ("gap", 28.0),
            ("win", 250.0),
            ("gap", 34.0),
            ("door", 196.0),
            ("gap", 34.0),
            ("win", 150.0),
        ];
        let sequence = if i == 0 { &front[..] } else { &other[..] };
        let mut elements = Vec::new();
        for &(kind, w) in sequence {
            if kind != "gap" {
                let e = Element {
                    kind,
                    u0: u,
                    u1: u + w,
                    car: i,
                    window: if kind == "win" {
                        Some(windows.len())
                    } else {
                        None
                    },
                };
                if kind == "win" {
                    windows.push(e.clone());
                }
                elements.push(e);
            }
            u += w;
        }
        cars.push(Car {
            i,
            u0: i as f64 * P,
            u1: i as f64 * P + P - G,
            elements,
        });
    }
    let freeze = a.freeze();
    let exit_at = a.exit_at.unwrap_or(117.85);
    let length = n as f64 * P - G;
    let bs: Vec<_> = s
        .beats
        .iter()
        .copied()
        .filter(|b| *b >= s.start() - 1.5 && *b < s.end() + 1.5)
        .collect();
    let spb = if bs.len() > 2 {
        (bs[bs.len() - 1] - bs[0]) / (bs.len() - 1) as f64
    } else {
        60.0 / a.bpm
    };
    let velocity = P / spb;
    if !velocity.is_finite() || velocity > 1e7 {
        return Err("Train actual beat velocity exceeds budget".into());
    }
    let base = W + length + velocity * (time(freeze[0], freeze) - time(exit_at, freeze));
    let hero_x = a.hero_x.unwrap_or(1010.0);
    let mut best = None;
    let mut distance = 1e9;
    for (i, e) in windows.iter().enumerate() {
        if e.u1 - e.u0 < 200.0 {
            continue;
        }
        let d = (base - (e.u0 + e.u1) / 2.0 - hero_x).abs();
        if d < distance {
            distance = d;
            best = Some(i);
        }
    }
    let shift = best.map_or(0.0, |i| {
        hero_x - (base - (windows[i].u0 + windows[i].u1) / 2.0)
    });
    let chars = a.characters();
    let mut ci = 0;
    let contents = windows
        .iter()
        .enumerate()
        .map(|(i, e)| {
            if best == Some(i) {
                let ch = chars[a.hero.unwrap_or(0) % chars.len()];
                Content {
                    character: Some(ch.into()),
                    crop: crop(ch, 0),
                    seed: 900.0 + i as f64,
                    hero: true,
                }
            } else if e.u1 - e.u0 >= 200.0 && rnd(&[i as f64, 44.0]) < 0.62 {
                let ch = chars[ci % chars.len()];
                ci += 1;
                Content {
                    character: Some(ch.into()),
                    crop: crop(ch, (i >> 1) % 2),
                    seed: 300.0 + i as f64,
                    hero: false,
                }
            } else {
                Content {
                    character: None,
                    crop: None,
                    seed: 500.0 + i as f64,
                    hero: false,
                }
            }
        })
        .collect();
    Ok(Geometry {
        cars,
        windows,
        contents,
        length,
        freeze,
        exit_at,
        velocity,
        shift,
        best,
    })
}
pub fn lamp_levels(beats: &[f64], bpm: f64, downbeat: i64, t: f64) -> [f64; 2] {
    let i = index(beats, t).map_or(-1, |i| i as i64) - downbeat;
    let ph = phase(beats, bpm, t);
    let on = i.rem_euclid(2);
    let env = sat(ph / 0.045) * (1.0 - 0.25 * ph) * (1.0 - 0.55 * smooth(0.8, 1.0, ph));
    let tail = 0.34 * dec(ph, 9.0) + 0.035;
    if on == 0 {
        [env, tail]
    } else {
        [tail, env]
    }
}
