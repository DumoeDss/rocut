// One-bit ordered luma dither. Artistic luma uses encoded RGB in the
// existing SDR effect pipeline, not a claim of linear-light photometry.
// A shared black/white decision is intentionally different from retro-dither's
// independent channel palette. Alpha is not quantized or premultiplied here.
struct VertexOutput { @builtin(position) position: vec4f, @location(0) tex_coord: vec2f }
struct EffectUniforms { resolution: vec2f, clock_seed: vec2f, controls: vec4f }
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var source_sampler: sampler;
@group(1) @binding(0) var<uniform> uniforms: EffectUniforms;

fn bayer2(p: vec2u) -> u32 { return ((p.x ^ p.y) & 1u) * 2u + (p.y & 1u); }
@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let base = textureSampleLevel(source, source_sampler, input.tex_coord, 0.0);
    if uniforms.controls.x == 0.0 { return base; }
    if base.a <= 0.000001 { return vec4f(0.0); }
    let seed = u32(uniforms.clock_seed.y);
    let cell = vec2u(floor(input.position.xy / uniforms.controls.z));
    let p = cell + vec2u(seed & 3u, (seed >> 2u) & 3u);
    let rank = bayer2(p) * 4u + bayer2(p >> vec2u(1u));
    let offset = ((f32(rank) + 0.5) / 16.0 - 0.5) * uniforms.controls.w;
    // Preserve pure black and white even at extreme author thresholds.
    let cutoff = clamp(uniforms.controls.y + offset, 0.0001, 0.9999);
    let luma = dot(base.rgb, vec3f(0.2126, 0.7152, 0.0722));
    let monochrome = vec3f(select(0.0, 1.0, luma >= cutoff));
    return vec4f(mix(base.rgb, monochrome, uniforms.controls.x), base.a);
}
