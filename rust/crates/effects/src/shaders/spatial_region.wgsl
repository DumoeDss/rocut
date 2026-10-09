// Shared circular region in pixel space, independent of frame aspect ratio.
fn region_weight(position: vec2f) -> f32 {
    if uniforms.mode.x == 0.0 { return 1.0; }
    let radius = uniforms.region.z * min(uniforms.resolution.x, uniforms.resolution.y);
    if radius <= 0.0 { return 0.0; }
    let distance = length(position - uniforms.region.xy * uniforms.resolution);
    if distance >= radius { return 0.0; }
    if uniforms.region.w == 0.0 { return 1.0; }
    return 1.0 - smoothstep(radius * (1.0 - uniforms.region.w), radius, distance);
}
