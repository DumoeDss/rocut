// Tape treatment: static raster lines, frame-keyed grain and
// horizontal chroma bleed. Straight alpha remains the source coverage.
struct VertexOutput { @builtin(position) position: vec4f, @location(0) tex_coord: vec2f }
struct EffectUniforms { resolution: vec2f, clock_seed: vec2f, controls: vec4f }
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var source_sampler: sampler;
@group(1) @binding(0) var<uniform> uniforms: EffectUniforms;

fn hash(value: u32) -> f32 {
    var v = value;
    v = (v ^ (v >> 16u)) * 2146121005u;
    v = (v ^ (v >> 15u)) * 2221713035u;
    return f32((v ^ (v >> 16u)) & 65535u) / 65535.0;
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let base = textureSampleLevel(source, source_sampler, input.tex_coord, 0.0);
    if uniforms.controls.x == 0.0 { return base; }
    if base.a <= 0.000001 { return vec4f(0.0); }
    let offset = vec2f(uniforms.controls.w / max(uniforms.resolution.x, 1.0), 0.0);
    let left = textureSampleLevel(source, source_sampler, input.tex_coord - offset, 0.0);
    let right = textureSampleLevel(source, source_sampler, input.tex_coord + offset, 0.0);
    let chroma = vec3f(mix(base.r, left.r, left.a), base.g, mix(base.b, right.b, right.a));
    let pixel = vec2u(input.position.xy);
    let random = hash(pixel.x + pixel.y * 4099u + u32(uniforms.clock_seed.x) * 131071u + u32(uniforms.clock_seed.y) * 524287u) - 0.5;
    let line = 1.0 - uniforms.controls.z * f32(pixel.y & 1u);
    let treated = clamp(chroma * line + vec3f(random * uniforms.controls.y), vec3f(0.0), vec3f(1.0));
    return vec4f(mix(base.rgb, treated, uniforms.controls.x), base.a);
}
