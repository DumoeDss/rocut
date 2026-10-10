use super::super::{CanvasStroke, rebuild};
use super::*;

fn config() -> CanvasConfig {
    CanvasConfig {
        columns: 8,
        rows: 8,
        duration_ticks: 120000,
        seed: 17,
        drying: 1.0,
        diffusion: 0.1,
        weave_frequency: 8.0,
        weave_height: 0.02,
        light: [0.2, -0.3, 0.9],
        relief: 2.0,
    }
}
#[test]
fn grid_identity_decodes_srgb_and_canonicalizes_poison_holes() {
    let mut rgba = vec![0u8; 8 * 8 * 4];
    for p in rgba.chunks_exact_mut(4) {
        p.copy_from_slice(&[128, 64, 255, 96]);
    }
    rgba[..4].copy_from_slice(&[250, 99, 71, 0]);
    let source = sample_rgba8_grid(&config(), &rgba, 8, 8).unwrap();
    assert_eq!(source[0], [0.0; 4]);
    assert!((source[1][0] - 0.21586050011389926 * 96.0 / 255.0).abs() < 1e-15);
    assert_eq!(source[1][2], 96.0 / 255.0);
    assert_eq!(source[1][3], 96.0 / 255.0);
}
#[test]
fn rectangular_grid_centers_use_premul_bilinear_clamp_not_square_crop() {
    let mut rgba = vec![0u8; 16 * 8 * 4];
    for y in 0..8 {
        for x in 0..16 {
            let i = (y * 16 + x) * 4;
            rgba[i..i + 4].copy_from_slice(if x % 2 == 0 {
                &[255, 0, 0, 255]
            } else {
                &[0, 255, 255, 0]
            });
        }
    }
    let source = sample_rgba8_grid(&config(), &rgba, 16, 8).unwrap();
    assert!(source.iter().all(|p| *p == [0.5, 0.0, 0.0, 0.5]));
    let tiny = sample_rgba8_grid(&config(), &[255, 0, 0, 255], 1, 1).unwrap();
    assert!(tiny.iter().all(|p| *p == [1.0, 0.0, 0.0, 1.0]));
}
#[test]
fn dimensions_exact_bytes_grid_and_work_are_checked_before_allocation() {
    let c = config();
    for (w, h, b) in [
        (0, 8, 0),
        (8, 0, 0),
        (8, 8, 255),
        (u32::MAX, 1, 0),
        (16384, 16384, 0),
    ] {
        assert!(sample_rgba8_grid(&c, &vec![0; b], w, h).is_err());
    }
    let mut c = c;
    c.columns = 129;
    assert!(sample_rgba8_grid(&c, &[0; 4], 1, 1).is_err());
    assert!(checked_f32(f64::NAN, 0.0, 1.0).is_err());
    assert!(checked_f32(f64::INFINITY, 0.0, f64::MAX).is_err());
    assert!(checked_f32(f64::MAX, 0.0, f64::MAX).is_err());
    assert!(checked_f32(-0.001, 0.0, 1.0).is_err());
}
#[test]
fn payload_uses_real_state_source_identity_and_preserves_material_seed_light() {
    let c = config();
    let rgba = vec![128u8; 8 * 8 * 4];
    let source = sample_rgba8_grid(&c, &rgba, 8, 8).unwrap();
    let stroke = CanvasStroke {
        start_ticks: 0,
        end_ticks: 60000,
        from: [0.1, 0.5],
        to: [0.9, 0.5],
        radius: 0.2,
        bristles: 8,
        opacity: 0.8,
        wetness: 1.0,
        thickness: 0.08,
    };
    let state = rebuild(&c, &[stroke], &source, 60000, 30, 1).unwrap();
    let payload = raster_payload(&c, &state, &rgba, 8, 8).unwrap();
    assert_eq!(std::mem::size_of::<CanvasRasterUniforms>(), 64);
    assert_eq!(payload.uniforms.geometry, [8, 8, 8, 8]);
    assert_eq!(payload.uniforms.metadata, [17, 0, 0, 0]);
    assert!(payload.pigment_coverage.iter().any(|p| p[3] > 0.0));
    for (i, cell) in state.cells().iter().enumerate() {
        assert_eq!(payload.pigment_coverage[i][0], cell.pigment[0] as f32);
        assert_eq!(payload.pigment_coverage[i][3], cell.coverage as f32);
        assert_eq!(payload.height_wetness[i][0], cell.height as f32);
        assert_eq!(payload.height_wetness[i][1], cell.wetness as f32);
    }
    let ln = c.light.iter().map(|v| v * v).sum::<f64>().sqrt();
    assert_eq!(payload.uniforms.light[0], (c.light[0] / ln) as f32);
    let mut changed = rgba.clone();
    changed[0] ^= 1;
    assert!(raster_payload(&c, &state, &changed, 8, 8).is_err());
    let mut changed = c;
    changed.seed += 1;
    assert!(raster_payload(&changed, &state, &rgba, 8, 8).is_err());
}
