// Ordered 4x4 dithering, derived from the public mathematical Bayer construction.
// Static by design, independent of seek order.
struct VertexOutput { @builtin(position) position: vec4f, @location(0) tex_coord: vec2f }
struct EffectUniforms { resolution: vec2f, clock_seed: vec2f, controls: vec4f, region: vec4f, mode: vec4f }
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var source_sampler: sampler;
@group(1) @binding(0) var<uniform> uniforms: EffectUniforms;

fn bayer2(p: vec2u) -> u32 { return ((p.x ^ p.y) & 1u) * 2u + (p.y & 1u); }
@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let base = textureSampleLevel(source, source_sampler, input.tex_coord, 0.0);
    let amount = uniforms.controls.x * region_weight(input.position.xy);
    if amount == 0.0 { return base; }
    if base.a <= 0.000001 { return vec4f(0.0); }
    let seed = u32(uniforms.clock_seed.y);
    let p = vec2u(floor(input.position.xy / uniforms.controls.z)) + vec2u(seed & 3u, (seed >> 2u) & 3u);
    let rank = bayer2(p) * 4u + bayer2(p >> vec2u(1u));
    let threshold = ((f32(rank) + 0.5) / 16.0 - 0.5) * uniforms.controls.w;
    let steps = uniforms.controls.y - 1.0;
    let quantized = clamp(floor(base.rgb * steps + vec3f(0.5 + threshold)) / steps, vec3f(0.0), vec3f(1.0));
    return vec4f(mix(base.rgb, quantized, amount), base.a);
}
