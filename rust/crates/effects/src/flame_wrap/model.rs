//! Bounded CPU reference seam. Production builds the same binary boundary on GPU.
//! Width uses eight directional rays, not a Euclidean distance transform.

pub(crate) const MAX_WORK: u64 = 4_000_000_000;
pub(crate) const MAX_BYTES: u64 = 384 * 1024 * 1024;
#[cfg(test)]
pub(crate) const DIRECTIONS: [[i32; 2]; 8] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
];

#[derive(Debug, PartialEq)]
pub(crate) struct Admission {
    pub pixels: usize,
    pub bytes: u64,
    pub steps: u64,
}

pub(crate) fn preflight(
    width: u32,
    height: u32,
    boundary_width: f32,
    flame_height: f32,
) -> Result<Admission, &'static str> {
    if width == 0 || height == 0 || width > 8192 || height > 8192 {
        return Err("Invalid dimensions");
    }
    if !boundary_width.is_finite()
        || !(1.0..=32.0).contains(&boundary_width)
        || !flame_height.is_finite()
        || !(1.0..=128.0).contains(&flame_height)
    {
        return Err("Invalid boundary support");
    }
    let pixels = u64::from(width) * u64::from(height);
    // Includes 9 alpha loads in prepass, center+directional mask loads,
    // plume mask loads, 9 spark anchors, base and 4 bilinear source taps.
    let steps =
        pixels * (9 + 1 + 8 * boundary_width.ceil() as u64 + flame_height.ceil() as u64 + 9 + 5);
    // Conservative CPU reference (16-byte premultiplied source + mask) and
    // GPU source/output/mask (12 bytes) admission, including simultaneous seams.
    let bytes = pixels * 29;
    if pixels > 16_777_216 || bytes > MAX_BYTES || steps > MAX_WORK {
        return Err("Flame Wrap preparation/work budget exceeded");
    }
    Ok(Admission {
        pixels: pixels as usize,
        bytes,
        steps,
    })
}

#[cfg(test)]
pub(crate) struct PreparedSource {
    pub width: u32,
    pub height: u32,
    pub premultiplied: Vec<[f32; 4]>,
    pub boundary: Vec<u8>,
}

#[cfg(test)]
pub(crate) fn srgb_to_linear(value: f32) -> f32 {
    if value <= 0.04045 {
        value / 12.92
    } else {
        ((value + 0.055) / 1.055).powf(2.4)
    }
}

#[cfg(test)]
pub(crate) fn linear_to_srgb(value: f32) -> f32 {
    if value <= 0.0031308 {
        value * 12.92
    } else {
        1.055 * value.powf(1.0 / 2.4) - 0.055
    }
}

/// The neutral seam keeps straight source pixels exactly, except hidden RGB.
#[cfg(test)]
pub(crate) fn composite(
    source: [f32; 4],
    warped: [f32; 4],
    amount: f32,
    fire: [f32; 3],
    fire_alpha: f32,
) -> [f32; 4] {
    if amount == 0.0 {
        return if source[3] == 0.0 { [0.0; 4] } else { source };
    }
    let mut base = [0.0; 4];
    if source[3] > 0.0 {
        for k in 0..3 {
            base[k] = srgb_to_linear(source[k]) * source[3];
        }
        base[3] = source[3];
    }
    let alpha = amount * fire_alpha;
    for k in 0..4 {
        base[k] = (base[k] * (1.0 - amount) + warped[k] * amount) * (1.0 - alpha);
    }
    for k in 0..3 {
        base[k] += fire[k] * alpha;
    }
    base[3] += alpha;
    if base[3] <= 0.0 {
        return [0.0; 4];
    }
    for k in 0..3 {
        base[k] = linear_to_srgb(base[k] / base[3]);
    }
    base
}

#[cfg(test)]
impl PreparedSource {
    pub(crate) fn prepare(
        width: u32,
        height: u32,
        pixels: &[[f32; 4]],
        boundary_width: f32,
        flame_height: f32,
    ) -> Result<Self, &'static str> {
        let admission = preflight(width, height, boundary_width, flame_height)?;
        if pixels.len() != admission.pixels {
            return Err("Source length mismatch");
        }
        // Validate before allocating. Hidden RGB under zero alpha is deliberately ignored.
        for p in pixels {
            if !p[3].is_finite()
                || !(0.0..=1.0).contains(&p[3])
                || (p[3] > 0.0
                    && p[..3]
                        .iter()
                        .any(|v| !v.is_finite() || !(0.0..=1.0).contains(v)))
            {
                return Err("Invalid visible source color");
            }
        }
        let mut premultiplied = Vec::new();
        let mut boundary = Vec::new();
        premultiplied
            .try_reserve_exact(admission.pixels)
            .map_err(|_| "Source allocation failed")?;
        boundary
            .try_reserve_exact(admission.pixels)
            .map_err(|_| "Mask allocation failed")?;
        premultiplied.extend(pixels.iter().map(|p| {
            if p[3] == 0.0 {
                [0.0; 4]
            } else {
                [
                    srgb_to_linear(p[0]) * p[3],
                    srgb_to_linear(p[1]) * p[3],
                    srgb_to_linear(p[2]) * p[3],
                    p[3],
                ]
            }
        }));
        boundary.resize(admission.pixels, 0);
        let occupied = |x: i32, y: i32| {
            x >= 0
                && y >= 0
                && x < width as i32
                && y < height as i32
                && pixels[y as usize * width as usize + x as usize][3] >= 0.5
        };
        for y in 0..height as i32 {
            for x in 0..width as i32 {
                if occupied(x, y) && DIRECTIONS.iter().any(|d| !occupied(x + d[0], y + d[1])) {
                    boundary[y as usize * width as usize + x as usize] = 1;
                }
            }
        }
        Ok(Self {
            width,
            height,
            premultiplied,
            boundary,
        })
    }

    pub(crate) fn mask(&self, p: [i32; 2]) -> f32 {
        if p[0] < 0 || p[1] < 0 || p[0] >= self.width as i32 || p[1] >= self.height as i32 {
            return 0.0;
        }
        f32::from(self.boundary[p[1] as usize * self.width as usize + p[0] as usize])
    }

    pub(crate) fn support(&self, p: [i32; 2], width: f32, height: f32, wind: f32) -> (f32, f32) {
        let mut ring = self.mask(p);
        for d in DIRECTIONS {
            for step in 1..=width.ceil() as i32 {
                let distance = step as f32
                    * if d[0] != 0 && d[1] != 0 {
                        std::f32::consts::SQRT_2
                    } else {
                        1.0
                    };
                if distance <= width {
                    ring = ring.max(
                        self.mask([p[0] + d[0] * step, p[1] + d[1] * step])
                            * (1.0 - distance / (width + 1.0)),
                    );
                }
            }
        }
        let mut plume = 0.0_f32;
        for step in 1..=height.ceil() as i32 {
            let rise = step as f32 / height;
            let origin = [p[0] - (wind * step as f32).round() as i32, p[1] + step];
            plume = plume.max(self.mask(origin) * (1.0 - rise).max(0.0));
        }
        (ring, plume)
    }

    pub(crate) fn sample(&self, p: [f32; 2]) -> [f32; 4] {
        let x = p[0] - 0.5;
        let y = p[1] - 0.5;
        let ix = x.floor() as i32;
        let iy = y.floor() as i32;
        let tap = |tx: i32, ty: i32| {
            if tx < 0 || ty < 0 || tx >= self.width as i32 || ty >= self.height as i32 {
                [0.0; 4]
            } else {
                self.premultiplied[ty as usize * self.width as usize + tx as usize]
            }
        };
        let taps = [
            tap(ix, iy),
            tap(ix + 1, iy),
            tap(ix, iy + 1),
            tap(ix + 1, iy + 1),
        ];
        let fx = x - x.floor();
        let fy = y - y.floor();
        let weights = [
            (1.0 - fx) * (1.0 - fy),
            fx * (1.0 - fy),
            (1.0 - fx) * fy,
            fx * fy,
        ];
        let mut result = [0.0; 4];
        for i in 0..4 {
            for k in 0..4 {
                result[k] += taps[i][k] * weights[i];
            }
        }
        result
    }
}
