#[path = "memories_math.rs"]
mod math;
pub const SIZE: [u32; 2] = [320, 246];
pub const CRUST: f64 = 0.024;
pub struct Seed {
    pub uv: [f64; 2],
    pub field: f64,
    pub k: usize,
}
pub struct Field {
    pub values: Vec<f32>,
    pub patches: Vec<f32>,
    pub face_level: f64,
    pub ash: Vec<Seed>,
    pub sparks: Vec<Seed>,
}
pub fn build(seed: f64, hero: bool, face: Option<[f64; 2]>) -> Field {
    let w = 320usize;
    let h = 246usize;
    let asp = 560.0 / 431.0;
    let angle = math::rnd(&[seed, 17.0]) * std::f64::consts::TAU;
    let igx = 0.5 + angle.cos() * 0.62;
    let igy = 0.5 + angle.sin() * 0.62;
    let mut values = Vec::with_capacity(w * h);
    let mut patches = Vec::with_capacity(w * h);
    let (mut min, mut max) = (1e9f64, -1e9f64);
    for y in 0..h {
        for x in 0..w {
            let u = (x as f64 + 0.5) / w as f64;
            let v = (y as f64 + 0.5) / h as f64;
            let e = (u.min(1.0 - u) * asp).min(v.min(1.0 - v)) * 2.0;
            let n = math::fbm2(u * 6.0 * asp, v * 6.0, seed + 101.0, 5);
            let di = ((u - igx) * asp).hypot(v - igy) / 1.7;
            let mut f = 0.62 * e.min(1.0).powf(0.7) + 0.55 * (n - 0.5) + 0.5 * di;
            if hero {
                if let Some(face) = face {
                    let du = (u - face[0]) * asp;
                    let dv = v - face[1];
                    f += 1.05 * (-(du * du + dv * dv) / 0.018).exp();
                }
            }
            values.push(f as f32);
            min = min.min(f);
            max = max.max(f);
            patches.push(
                (0.7 * math::vn2(x as f64 * 0.16, y as f64 * 0.16, seed + 77.0)
                    + 0.3 * math::hsh(x as f64, y as f64, seed + 78.0)) as f32,
            );
        }
    }
    for v in &mut values {
        *v = ((*v as f64 - min) / (max - min)) as f32;
    }
    let face_level = if hero {
        let mut sorted = values.clone();
        sorted.sort_by(f32::total_cmp);
        sorted[(sorted.len() as f64 * 0.935).floor() as usize] as f64
    } else {
        1.0
    };
    let at = |uv: [f64; 2]| {
        values[(uv[1] * h as f64).trunc().clamp(0.0, (h - 1) as f64) as usize * w
            + (uv[0] * w as f64).trunc().clamp(0.0, (w - 1) as f64) as usize] as f64
    };
    let mut ash = Vec::with_capacity(110);
    for k in 0..110 {
        let uv = [
            math::rnd(&[k as f64, seed, 1.0]),
            math::rnd(&[k as f64, seed, 2.0]),
        ];
        ash.push(Seed {
            uv,
            field: at(uv),
            k,
        });
    }
    let mut sparks = Vec::with_capacity(90);
    for k in 0..90 {
        let uv = [
            math::rnd(&[k as f64, seed, 5.0]),
            math::rnd(&[k as f64, seed, 6.0]),
        ];
        sparks.push(Seed {
            uv,
            field: at(uv),
            k,
        });
    }
    Field {
        values,
        patches,
        face_level,
        ash,
        sparks,
    }
}
pub struct Buffers {
    pub keep: Vec<u8>,
    pub over: Vec<u8>,
    pub glow: Vec<u8>,
}
pub fn render(field: &Field, b: f64, t: f64) -> Result<Buffers, &'static str> {
    if !b.is_finite() || !t.is_finite() {
        return Err("Invalid Memories burn field clock");
    }
    let n = field.values.len();
    if n != 320 * 246 || field.patches.len() != n {
        return Err("Invalid Memories field dimensions");
    }
    let mut keep = vec![0; n * 4];
    let mut over = vec![0; n * 4];
    let mut glow = vec![0; n * 4];
    let fl = t * 17.0;
    for i in 0..n {
        let d = field.values[i] as f64 - b;
        let j = i * 4;
        keep[j + 3] = if d > -CRUST + 0.004 {
            255
        } else if d < -CRUST - 0.006 {
            0
        } else {
            ((d + CRUST + 0.006) / 0.01 * 255.0).trunc() as u8
        };
        if d < 0.0 {
            over[j..j + 4].copy_from_slice(&[18, 12, 10, 255]);
        } else if d < 0.055 {
            let s = 1.0 - d / 0.055;
            over[j] = math::byte(64.0 - 40.0 * s);
            over[j + 1] = math::byte(30.0 - 18.0 * s);
            over[j + 2] = math::byte(12.0 - 4.0 * s);
            over[j + 3] = (70.0 + 185.0 * s * s).trunc() as u8;
        } else if d < 0.16 {
            let s = 1.0 - (d - 0.055) / 0.105;
            over[j..j + 4].copy_from_slice(&[128, 82, 36, (70.0 * s * s).trunc() as u8]);
        }
        let nz = field.patches[i] as f64;
        let mut intensity = if d > 0.0 {
            (-d * d / 0.000055).exp()
        } else {
            (-d * d / 0.00011).exp() * 0.8
        };
        intensity *= 0.7 + 0.5 * nz;
        if d < 0.0 && d > -CRUST {
            let e = (nz - 0.5).max(0.0) * 2.2 * (0.6 + 0.4 * (fl + nz * 40.0).sin());
            intensity = intensity.max(e * (1.0 + d / CRUST) * 0.75);
        }
        intensity *= 0.85 + 0.15 * (fl * 1.7 + nz * 25.0).sin();
        if intensity < 0.012 {
            continue;
        }
        let c = intensity.min(1.0);
        let rgb = if c < 0.45 {
            let k = c / 0.45;
            [150.0 + 105.0 * k, 22.0 + 60.0 * k, 6.0 + 12.0 * k]
        } else if c < 0.82 {
            let k = (c - 0.45) / 0.37;
            [255.0, 82.0 + 100.0 * k, 18.0 + 55.0 * k]
        } else {
            let k = (c - 0.82) / 0.18;
            [255.0, 182.0 + 68.0 * k, 73.0 + 150.0 * k]
        };
        for k in 0..3 {
            glow[j + k] = math::byte(rgb[k]);
        }
        glow[j + 3] = (255.0 * (intensity * 1.25).min(1.0)).trunc() as u8;
    }
    Ok(Buffers { keep, over, glow })
}
