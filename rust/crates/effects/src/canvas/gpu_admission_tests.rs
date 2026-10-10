use super::super::super::raster::CanvasRasterUniforms;
use super::*;

fn payload() -> CanvasRasterPayload {
    CanvasRasterPayload {
        uniforms: CanvasRasterUniforms {
            geometry: [32, 16, 8, 8],
            material: [8.0, 0.02, 2.0, 0.0],
            light: [0.0, 0.0, 1.0, 0.0],
            metadata: [17, 0, 0, 0],
        },
        pigment_coverage: vec![[0.1, 0.2, 0.3, 0.5]; 64],
        height_wetness: vec![[0.04, 0.8, 0.0, 0.0]; 64],
    }
}

#[test]
fn layout_admits_exact_payload_and_storage_not_srgb() {
    assert_eq!(
        payload_layout(32, 16, &payload(), 8192).unwrap(),
        (8, 8, 128)
    );
    assert_eq!(std::mem::size_of::<PackedUniforms>(), 64);
    assert!(supported(wgpu::TextureFormat::Rgba8Unorm));
    assert!(supported(wgpu::TextureFormat::Bgra8Unorm));
    assert!(!supported(wgpu::TextureFormat::Rgba8UnormSrgb));
    assert!(!supported(wgpu::TextureFormat::Bgra8UnormSrgb));
    assert!(!supported(wgpu::TextureFormat::Rgba32Float));
}

#[test]
fn admission_rejects_shape_budget_nonfinite_and_out_of_range_before_gpu() {
    for (w, h, limit) in [
        (0, 16, 8192),
        (32, 0, 8192),
        (31, 16, 8192),
        (32, 16, 16),
        (u32::MAX, u32::MAX, u32::MAX),
    ] {
        assert!(payload_layout(w, h, &payload(), limit).is_err());
    }
    let mut p = payload();
    p.pigment_coverage.pop();
    assert!(payload_layout(32, 16, &p, 8192).is_err());
    let mut p = payload();
    p.height_wetness.push([0.0; 4]);
    assert!(payload_layout(32, 16, &p, 8192).is_err());
    for bad in [f32::NAN, f32::INFINITY, -0.01, 1.01] {
        let mut p = payload();
        p.pigment_coverage[0][3] = bad;
        assert!(payload_layout(32, 16, &p, 8192).is_err());
    }
    let mut p = payload();
    p.pigment_coverage[0][0] = 0.6;
    assert!(payload_layout(32, 16, &p, 8192).is_err());
    let mut p = payload();
    p.height_wetness[0][2] = f32::NAN;
    assert!(payload_layout(32, 16, &p, 8192).is_err());
    let mut p = payload();
    p.uniforms.light = [0.0; 4];
    assert!(payload_layout(32, 16, &p, 8192).is_err());
    let mut p = payload();
    p.uniforms.metadata[1] = 1;
    assert!(payload_layout(32, 16, &p, 8192).is_err());
    let mut p = payload();
    p.uniforms.material[0] = f32::INFINITY;
    assert!(payload_layout(32, 16, &p, 8192).is_err());
}
