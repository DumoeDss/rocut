#[path = "memories_math.rs"]
mod math;
pub fn grade(rgba: &[u8], lut: &[u8], seed: f64) -> Result<Vec<u8>, &'static str> {
    let (w, h) = (1040usize, 650usize);
    if rgba.len() != w * h * 4 || lut.len() != 768 || !seed.is_finite() {
        return Err("Invalid Memories composite or native LUT");
    }
    let mut out = rgba.to_vec();
    let side = math::rnd(&[seed, 3.0]) >= 0.5;
    let leak_y = 0.25 + 0.5 * math::rnd(&[seed, 4.0]);
    for y in 0..h {
        let vy = y as f64 / h as f64;
        for x in 0..w {
            let i = (y * w + x) * 4;
            let r = rgba[i] as f64 / 255.0;
            let g = rgba[i + 1] as f64 / 255.0;
            let b = rgba[i + 2] as f64 / 255.0;
            let l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            let s = l * l * (3.0 - 2.0 * l);
            let mut lc = 0.085 + 0.83 * (0.55 * l + 0.45 * s);
            let vx = x as f64 / w as f64;
            let ex = vx - 0.5;
            let ey = (vy - 0.5) * 0.8;
            lc *= 1.0 - 0.5 * (ex * ex + ey * ey);
            let li = (lc * 255.0).trunc().clamp(0.0, 255.0) as usize * 3;
            let mut rgb = [
                lut[li] as f64 + (r - l) * 255.0 * 0.2,
                lut[li + 1] as f64 + (g - l) * 255.0 * 0.2,
                lut[li + 2] as f64 + (b - l) * 255.0 * 0.2,
            ];
            let ws = (1.0 - lc) * (1.0 - lc) * 0.17;
            let wh = lc * lc * 0.12;
            for k in 0..3 {
                rgb[k] += ([156.0, 194.0, 192.0][k] - rgb[k]) * ws
                    + ([201.0, 141.0, 134.0][k] - rgb[k]) * wh;
            }
            let lx = if side { 1.0 - vx } else { vx };
            let leak = (-lx * lx * 18.0).exp()
                * (0.55 + 0.45 * (vy * 5.3 + seed).sin())
                * (-(vy - leak_y).powi(2) * 3.0).exp();
            let grain = (math::hsh(x as f64, y as f64, seed) - 0.5) * 14.0;
            for k in 0..3 {
                rgb[k] += [120.0, 52.0, 18.0][k] * leak;
                out[i + k] = math::byte(rgb[k] * 0.93 + [239.0, 230.0, 214.0][k] * 0.07 + grain);
            }
        }
    }
    Ok(out)
}
pub fn tooth(rgba: &[u8], seed: f64) -> Result<Vec<u8>, &'static str> {
    let (w, h) = (1120usize, 862usize);
    if rgba.len() != w * h * 4 {
        return Err("Invalid Memories print readback");
    }
    let mut out = rgba.to_vec();
    for y in 0..h {
        for x in 0..w {
            let i = (y * w + x) * 4;
            if out[i + 3] == 0 || (x > 40 && x < 1080 && y > 40 && y < 690) {
                continue;
            }
            let n = (math::hsh((x >> 1) as f64, (y >> 1) as f64, seed + 5.0) - 0.5) * 10.0
                + (math::hsh(x as f64, y as f64, seed + 9.0) - 0.5) * 6.0;
            for k in 0..3 {
                out[i + k] = math::byte(out[i + k] as f64 + n);
            }
        }
    }
    Ok(out)
}
pub fn desk_grain(rgba: &[u8], seed: f64) -> Result<Vec<u8>, &'static str> {
    let (w, h) = (1200usize, 675usize);
    if rgba.len() != w * h * 4 {
        return Err("Invalid Memories desk readback");
    }
    let mut out = rgba.to_vec();
    for y in 0..h {
        for x in 0..w {
            let i = (y * w + x) * 4;
            let gr = (math::hsh(x as f64, y as f64, seed) - 0.5) * 7.0
                + (math::hsh((x >> 2) as f64, (y >> 2) as f64, seed + 1.0) - 0.5) * 5.0;
            for k in 0..3 {
                out[i + k] = math::byte(out[i + k] as f64 + gr * [1.0, 0.9, 0.8][k]);
            }
        }
    }
    Ok(out)
}
pub fn desk_mottle(seed: f64) -> Vec<u8> {
    let mut out = vec![0; 160 * 90 * 4];
    for y in 0..90 {
        for x in 0..160 {
            let n = math::fbm2(x as f64 / 14.0, y as f64 / 14.0, seed + 3.0, 4);
            let n2 = math::fbm2(x as f64 / 5.0, y as f64 / 5.0, seed + 13.0, 2);
            let v = 128.0 + (n - 0.5) * 120.0 + (n2 - 0.5) * 40.0;
            let i = (y * 160 + x) * 4;
            out[i] = math::byte(v);
            out[i + 1] = math::byte(v * 0.97);
            out[i + 2] = math::byte(v * 0.92);
            out[i + 3] = 255;
        }
    }
    out
}
