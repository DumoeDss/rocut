use super::{Binding, Progress, Roi};

pub(super) struct Mask {
    pixels: Vec<u8>,
    pub(super) indices: Vec<u32>,
}

impl Mask {
    pub(super) fn new(binding: &Binding, roi: Roi, rgba: &[u8]) -> Result<Self, String> {
        let width = roi.width as usize;
        let height = roi.height as usize;
        let count = width
            .checked_mul(height)
            .ok_or("Flame mask size overflow")?;
        let [cx, cy, _, rx, ry, cr] = binding.flame_at;
        let ey = cy - ry * 0.3;
        let mut pixels = vec![0u8; count];
        for (q, pixel) in rgba.chunks_exact(4).enumerate() {
            let x = f64::from(roi.x) + (q % width) as f64;
            let y = f64::from(roi.y) + (q / width) as f64;
            if ((x - cx) / rx).powi(2) + ((y - ey) / ry).powi(2) > 1.0 {
                continue;
            }
            let r = f64::from(pixel[0]);
            let g = f64::from(pixel[1]);
            let b = f64::from(pixel[2]);
            let flame = r > 170.0 && b < 0.45 * r && g > 0.3 * r;
            let core = (x - cx).hypot(y - cy) < cr && r + g + b > 540.0;
            if flame || core {
                pixels[q] = 1;
            }
        }
        let mut next = vec![0u8; count];
        for _ in 0..3 {
            next.copy_from_slice(&pixels);
            for j in 1..height.saturating_sub(1) {
                for i in 1..width.saturating_sub(1) {
                    let q = j * width + i;
                    if pixels[q] == 0
                        && (pixels[q - 1] != 0
                            || pixels[q + 1] != 0
                            || pixels[q - width] != 0
                            || pixels[q + width] != 0)
                    {
                        next[q] = 1;
                    }
                }
            }
            std::mem::swap(&mut pixels, &mut next);
        }
        // Allocate exactly M, avoiding Vec geometric capacity hidden from budget.
        let interior = |q: usize| {
            q % width > 0 && q / width > 0 && q % width < width - 1 && q / width < height - 1
        };
        let masked = pixels
            .iter()
            .enumerate()
            .filter(|(q, m)| **m != 0 && interior(*q))
            .count();
        let mut indices = Vec::with_capacity(masked);
        for (q, m) in pixels.iter().enumerate() {
            if *m != 0 && interior(q) {
                indices.push(q as u32);
            }
        }
        Ok(Self { pixels, indices })
    }
}

pub(super) struct State {
    rgba: Vec<u8>,
    rgb: Vec<f32>,
    indices: Vec<u32>,
    width: usize,
    iteration: u32,
    cursor: usize,
    updates: u64,
}

impl State {
    pub(super) fn new(roi: Roi, rgba: &[u8], mask: Mask) -> Self {
        let mut sums = [0.0f64; 3];
        let mut count = 0usize;
        for (q, pixel) in rgba.chunks_exact(4).enumerate() {
            if mask.pixels[q] == 0 {
                for c in 0..3 {
                    sums[c] += f64::from(pixel[c]);
                }
                count += 1;
            }
        }
        let mut rgb = vec![0.0f32; mask.pixels.len() * 3];
        for (q, pixel) in rgba.chunks_exact(4).enumerate() {
            for c in 0..3 {
                // JS Number arithmetic followed by Float32Array assignment.
                // No unmasked pixels means NaN, matching the original reference.
                rgb[q * 3 + c] = if mask.pixels[q] != 0 {
                    (sums[c] / count as f64 * 0.6) as f32
                } else {
                    f32::from(pixel[c])
                };
            }
        }
        let empty = mask.indices.is_empty();
        Self {
            rgba: rgba.to_vec(),
            rgb,
            indices: mask.indices,
            width: roi.width as usize,
            iteration: if empty { 220 } else { 0 },
            cursor: 0,
            updates: 0,
        }
    }

    pub(super) fn complete(&self) -> bool {
        self.iteration == 220
    }

    pub(super) fn step(&mut self, max_pixels: u32) -> Progress {
        for _ in 0..max_pixels {
            if self.complete() {
                break;
            }
            let q = self.indices[self.cursor] as usize;
            for c in 0..3 {
                // Preserve left-to-right JS f64 addition and only round at the
                // assignment. f32 arithmetic or Jacobi buffers change output.
                let left = f64::from(self.rgb[(q - 1) * 3 + c]);
                let right = f64::from(self.rgb[(q + 1) * 3 + c]);
                let up = f64::from(self.rgb[(q - self.width) * 3 + c]);
                let down = f64::from(self.rgb[(q + self.width) * 3 + c]);
                self.rgb[q * 3 + c] = (0.25 * (((left + right) + up) + down)) as f32;
            }
            self.updates += 3;
            self.cursor += 1;
            if self.cursor == self.indices.len() {
                self.cursor = 0;
                self.iteration += 1;
            }
        }
        Progress {
            complete: self.complete(),
            channel_updates: self.updates,
        }
    }

    pub(super) fn finish(mut self) -> Vec<u8> {
        for q in self.indices {
            for c in 0..3 {
                self.rgba[q as usize * 4 + c] =
                    to_uint8_clamp(f64::from(self.rgb[q as usize * 3 + c]));
            }
        }
        self.rgba
    }
}

fn to_uint8_clamp(value: f64) -> u8 {
    if value.is_nan() || value <= 0.0 {
        return 0;
    }
    if value >= 255.0 {
        return 255;
    }
    let floor = value.floor();
    let fraction = value - floor;
    if fraction > 0.5 || (fraction == 0.5 && floor as u32 % 2 != 0) {
        (floor + 1.0) as u8
    } else {
        floor as u8
    }
}

#[cfg(test)]
mod tests {
    use super::{State, to_uint8_clamp};

    #[test]
    fn first_row_uses_updated_left_neighbor_in_the_same_iteration() {
        let mut rgb = vec![0.0; 5 * 5 * 3];
        for c in 0..3 {
            rgb[6 * 3 + c] = 10.0;
            rgb[7 * 3 + c] = 10.0;
            rgb[8 * 3 + c] = 20.0;
        }
        let mut state = State {
            rgba: vec![0; 5 * 5 * 4],
            rgb,
            indices: vec![6, 7],
            width: 5,
            iteration: 0,
            cursor: 0,
            updates: 0,
        };
        state.step(2);
        assert_eq!(&state.rgb[6 * 3..6 * 3 + 3], &[2.5, 2.5, 2.5]);
        assert_eq!(&state.rgb[7 * 3..7 * 3 + 3], &[5.625, 5.625, 5.625]);
        assert_eq!(state.iteration, 1);
    }

    #[test]
    fn addition_matches_js_number_before_float32_assignment() {
        let mut rgb = vec![0.0; 5 * 5 * 3];
        rgb[5 * 3] = 16_777_216.0;
        rgb[7 * 3] = 1.0;
        rgb[1 * 3] = -16_777_216.0;
        rgb[11 * 3] = 1.0;
        let mut state = State {
            rgba: vec![0; 5 * 5 * 4],
            rgb,
            indices: vec![6],
            width: 5,
            iteration: 0,
            cursor: 0,
            updates: 0,
        };
        state.step(1);
        assert_eq!(state.rgb[6 * 3], 0.5);
    }
    #[test]
    fn canvas_bytes_use_saturation_and_ties_to_even() {
        for (value, expected) in [
            (f64::NAN, 0),
            (f64::NEG_INFINITY, 0),
            (-1.0, 0),
            (0.5, 0),
            (1.5, 2),
            (2.5, 2),
            (3.5, 4),
            (254.5, 254),
            (255.5, 255),
            (f64::INFINITY, 255),
        ] {
            assert_eq!(to_uint8_clamp(value), expected);
        }
    }
}
