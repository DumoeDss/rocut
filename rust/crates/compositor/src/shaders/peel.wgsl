struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) @interpolate(perspective, center) uv: vec2f,
    @location(1) brightness: f32,
    @location(2) opacity: f32,
}
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var source_sampler: sampler;
@vertex
fn vertex_main(@location(0) position: vec4f, @location(1) uv: vec2f,
    @location(2) brightness: f32, @location(3) opacity: f32) -> VertexOutput {
    // Non-unit clip w enables GPU perspective-correct source UV interpolation.
    return VertexOutput(position, uv, brightness, opacity);
}
@fragment
fn fragment_premultiplied(input: VertexOutput) -> @location(0) vec4f {
    let color = textureSample(source, source_sampler, input.uv);
    let alpha = color.a * input.opacity;
    return vec4f(color.rgb * input.brightness * alpha, alpha);
}
@vertex
fn vertex_fullscreen(@builtin(vertex_index) index: u32) -> VertexOutput {
    let uv = vec2f(f32((index << 1u) & 2u), f32(index & 2u));
    return VertexOutput(vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0), uv, 1.0, 1.0);
}
@fragment
fn fragment_straight(input: VertexOutput) -> @location(0) vec4f {
    // Exact texel loads avoid interpolating the temporary premultiplied pixels.
    let color = textureLoad(source, vec2i(input.position.xy), 0);
    if color.a <= 0.0 { return vec4f(0.0); }
    return vec4f(clamp(color.rgb / color.a, vec3f(0.0), vec3f(1.0)), color.a);
}
