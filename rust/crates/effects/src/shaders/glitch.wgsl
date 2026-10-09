// Band displacement. Every band is a pure function of frame/seed;
// interpolation is premultiplied, output is straight alpha for the compositor.
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
fn sample_straight(uv: vec2f) -> vec4f {
    // Nearest pixels prevent straight-RGB linear filtering from introducing dark
    // fringes at a transparent edge; out-of-picture samples are transparent.
    let size = vec2i(textureDimensions(source));
    let p = vec2i(floor(uv * vec2f(size)));
    if any(p < vec2i(0)) || any(p >= size) { return vec4f(0.0); }
    return textureLoad(source, p, 0);
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let base = sample_straight(input.tex_coord);
    if uniforms.controls.x == 0.0 || uniforms.controls.w == 0.0 || uniforms.controls.y == 0.0 { return base; }
    let band = u32(floor(input.tex_coord.y * uniforms.controls.z));
    let key = band * 4099u + u32(uniforms.clock_seed.x) * 131071u + u32(uniforms.clock_seed.y) * 524287u;
    if hash(key) >= uniforms.controls.w { return base; }
    let shift = (hash(key + 15731u) * 2.0 - 1.0) * uniforms.controls.y;
    let moved = sample_straight(input.tex_coord + vec2f(shift, 0.0));
    let alpha = mix(base.a, moved.a, uniforms.controls.x);
    if alpha <= 0.000001 { return vec4f(0.0); }
    let rgb = mix(base.rgb * base.a, moved.rgb * moved.a, uniforms.controls.x) / alpha;
    return vec4f(rgb, alpha);
}
