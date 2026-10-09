use effects::{EffectPass, UniformValue, resolve_stylized_effect_json};
use serde_json::{Value, json};

use crate::liquid_fixture::CELLS;

#[derive(Clone, Copy)]
pub struct Optics {
    pub amount: f64,
    pub refraction: f64,
    pub dye_opacity: f64,
    pub color: [f64; 3],
}

impl Default for Optics {
    fn default() -> Self {
        Self {
            amount: 1.0,
            refraction: 0.25,
            dye_opacity: 0.5,
            color: [0.125, 0.75, 1.0],
        }
    }
}

impl Optics {
    pub fn params(self) -> Value {
        json!({"amount":self.amount,"refraction":self.refraction,
            "dyeOpacity":self.dye_opacity,
            "colorR":self.color[0],"colorG":self.color[1],"colorB":self.color[2]})
    }
}

pub fn pass(changes: Value, local_time: i64, portrait: bool) -> EffectPass {
    let mut params = json!({
        "amount":1,"refraction":0.25,"dyeOpacity":0.5,
        "colorR":0.125,"colorG":0.75,"colorB":1,
        "columns":12,"rows":8,"viscosity":0.0078125,
        "velocityDamping":0.5,"dyeDissipation":0.25,
        "pressureIterations":40,"diffusionIterations":8,"vorticity":1.5,
        "durationTicks":60000,"eventCount":2,
        "event0Time":0,"event0X":0.5,"event0Y":0.5,
        "event0Radius":0.375,"event0VelocityX":2,"event0VelocityY":-1,"event0Dye":0.75,
        "event1Time":8000,"event1X":0.25,"event1Y":0.75,
        "event1Radius":0.25,"event1VelocityX":-1,"event1VelocityY":2,"event1Dye":0.5
    });
    if portrait {
        for (a, b) in [
            ("columns", "rows"),
            ("event0X", "event0Y"),
            ("event0VelocityX", "event0VelocityY"),
            ("event1X", "event1Y"),
            ("event1VelocityX", "event1VelocityY"),
        ] {
            let first = params[a].clone();
            params[a] = params[b].clone();
            params[b] = first;
        }
    }
    for (key, value) in changes.as_object().unwrap() {
        params[key] = value.clone();
    }
    let resolved: Value = serde_json::from_str(&resolve_stylized_effect_json(
        json!({"effectType":"liquid","params":params,"localTime":local_time,
            "frameRate":{"numerator":120,"denominator":1}})
        .to_string(),
    ))
    .unwrap();
    EffectPass {
        shader: "liquid".into(),
        uniforms: resolved["passes"][0]["uniforms"]
            .as_object()
            .unwrap_or_else(|| panic!("expected active Liquid pass: {resolved}"))
            .iter()
            .map(|(key, value)| {
                let value = if let Some(items) = value.as_array() {
                    UniformValue::Vector(
                        items
                            .iter()
                            .map(|item| item.as_f64().unwrap() as f32)
                            .collect(),
                    )
                } else {
                    UniformValue::Number(value.as_f64().unwrap() as f32)
                };
                (key.clone(), value)
            })
            .collect(),
    }
}

pub fn source(width: u32, height: u32, alternate: bool, holes: bool) -> Vec<u8> {
    (0..height)
        .flat_map(|y| {
            (0..width).flat_map(move |x| {
                let mut p = [
                    (255 * x / (width - 1)) as u8,
                    (255 * y / (height - 1)) as u8,
                    if (x / 11 + y / 7) % 2 == 0 { 32 } else { 224 },
                    if holes {
                        [0, 1, 96, 255][((x / 11 + y / 9) % 4) as usize]
                    } else {
                        255
                    },
                ];
                if alternate {
                    p = [255 - p[2], p[0], 255 - p[1], p[3]];
                }
                if p[3] == 0 {
                    p[..3].copy_from_slice(&[255, 0, 255]);
                }
                p
            })
        })
        .collect()
}

fn field(x: f64, y: f64, width: u32, height: u32, portrait: bool) -> [f64; 3] {
    let (columns, rows) = if portrait { (8, 12) } else { (12, 8) };
    let gx = x / f64::from(width) * f64::from(columns) - 0.5;
    let gy = y / f64::from(height) * f64::from(rows) - 0.5;
    let mut result = [0.0; 3];
    for dy in 0..2 {
        for dx in 0..2 {
            let ix = (gx.floor() as i32 + dx).clamp(0, columns - 1) as usize;
            let iy = (gy.floor() as i32 + dy).clamp(0, rows - 1) as usize;
            let weight = (1.0 - (gx - gx.floor() - f64::from(dx)).abs())
                * (1.0 - (gy - gy.floor() - f64::from(dy)).abs());
            let cell = if portrait {
                let c = CELLS[ix * 12 + iy];
                [c[1], c[0], c[2]]
            } else {
                CELLS[iy * 12 + ix]
            };
            for k in 0..3 {
                result[k] += weight * f64::from(cell[k]);
            }
        }
    }
    result
}

fn sample(input: &[u8], width: u32, height: u32, x: f64, y: f64) -> [f64; 4] {
    let mut taps = [[0.0; 4]; 4];
    let (x, y) = (x - 0.5, y - 0.5);
    for dy in 0..2 {
        for dx in 0..2 {
            let ix = x.floor() as i32 + dx;
            let iy = y.floor() as i32 + dy;
            if ix < 0 || iy < 0 || ix >= width as i32 || iy >= height as i32 {
                continue;
            }
            let p = &input[((iy as u32 * width + ix as u32) * 4) as usize..][..4];
            let alpha = f64::from(p[3]) / 255.0;
            let tap = &mut taps[(dy * 2 + dx) as usize];
            for k in 0..3 {
                tap[k] = alpha * f64::from(p[k]) / 255.0;
            }
            tap[3] = alpha;
        }
    }
    // Affine differences preserve constant coverage exactly. Summing four weighted
    // alphas can drift by one ulp and cross the half-unorm transparency threshold.
    let (fx, fy) = (x - x.floor(), y - y.floor());
    std::array::from_fn(|k| {
        let upper = taps[0][k] + (taps[1][k] - taps[0][k]) * fx;
        let lower = taps[2][k] + (taps[3][k] - taps[2][k]) * fx;
        upper + (lower - upper) * fy
    })
}

pub fn reference(input: &[u8], width: u32, height: u32, portrait: bool, optics: Optics) -> Vec<u8> {
    let mut output = Vec::with_capacity(input.len());
    for y in 0..height {
        for x in 0..width {
            let p = &input[((y * width + x) * 4) as usize..][..4];
            let center = [f64::from(x) + 0.5, f64::from(y) + 0.5];
            let flow = field(center[0], center[1], width, height, portrait);
            if optics.amount == 0.0 || flow == [0.0; 3] {
                output.extend_from_slice(p);
                continue;
            }
            let offset =
                optics.refraction * f64::from(width.min(height)) / (1.0 + flow[0].hypot(flow[1]));
            let refracted = sample(
                input,
                width,
                height,
                center[0] + flow[0] * offset,
                center[1] + flow[1] * offset,
            );
            let dye = (1.0 - (-flow[2]).exp()) * optics.dye_opacity;
            let alpha =
                (1.0 - optics.amount) * f64::from(p[3]) / 255.0 + optics.amount * refracted[3];
            if alpha <= 0.5 / 255.0 {
                output.extend_from_slice(&[0; 4]);
                continue;
            }
            for k in 0..3 {
                let base = f64::from(p[k]) * f64::from(p[3]) / (255.0 * 255.0);
                let dyed = (1.0 - dye) * refracted[k] + dye * optics.color[k] * refracted[3];
                let straight = ((1.0 - optics.amount) * base + optics.amount * dyed) / alpha;
                output.push((straight.clamp(0.0, 1.0) * 255.0).round() as u8);
            }
            output.push((alpha.clamp(0.0, 1.0) * 255.0).round() as u8);
        }
    }
    output
}

pub fn assert_raster(actual: &[u8], expected: &[u8], width: u32, label: &str) {
    assert_eq!(actual.len(), expected.len(), "{label}: byte length");
    for (i, (a, e)) in actual.iter().zip(expected).enumerate() {
        // Fixed before GPU execution: f32 shader versus f64 reference and unorm rounding.
        // Identity cases use assert_eq! separately and permit no byte differences.
        let tolerance = if i % 4 == 3 { 1 } else { 2 };
        assert!(
            a.abs_diff(*e) <= tolerance,
            "{label}: ({},{}) channel {}: actual {a}, expected {e}, tolerance {tolerance}",
            i / 4 % width as usize,
            i / 4 / width as usize,
            i % 4
        );
    }
}

pub fn changed_pixels(first: &[u8], second: &[u8]) -> usize {
    first
        .chunks_exact(4)
        .zip(second.chunks_exact(4))
        .filter(|(a, b)| a.iter().zip(*b).any(|(x, y)| x.abs_diff(*y) > 8))
        .count()
}

#[test]
fn bilinear_reference_preserves_constant_alpha_exactly() {
    let fractions = [0.0, 0.032706215866636, 0.25, 0.56065448633136, 0.75, 1.0];
    for alpha in [0, 1, 2, 96, 255] {
        let input = [
            188, 112, 224, alpha, 191, 112, 224, alpha, 188, 117, 32, alpha, 191, 117, 32, alpha,
        ];
        for fx in fractions {
            for fy in fractions {
                assert_eq!(
                    sample(&input, 2, 2, 0.5 + fx, 0.5 + fy)[3],
                    f64::from(alpha) / 255.0,
                    "constant alpha {alpha} at {fx},{fy}"
                );
            }
        }
    }
}

#[test]
fn reference_half_unorm_threshold_is_inclusive_without_roundoff_coverage() {
    let input = source(93, 62, false, true);
    let index = (27 * 93 + 65) * 4;
    assert_eq!(input[index + 3], 0);
    // Frozen flow samples these four texels; each has exactly one unorm alpha unit.
    for (x, y) in [(68, 27), (69, 27), (68, 28), (69, 28)] {
        assert_eq!(input[(y * 93 + x) * 4 + 3], 1);
    }
    for amount in [0.25, 0.5, 0.75] {
        let optics = Optics {
            amount,
            ..Optics::default()
        };
        let output = reference(&input, 93, 62, false, optics);
        let pixel = &output[index..index + 4];
        if amount <= 0.5 {
            assert_eq!(
                pixel,
                &[0, 0, 0, 0],
                "at/below half-unorm must be transparent"
            );
        } else {
            assert_eq!(pixel[3], 1, "above half-unorm must retain coverage");
            assert!(pixel[..3].iter().any(|channel| *channel > 0));
        }
    }
}
