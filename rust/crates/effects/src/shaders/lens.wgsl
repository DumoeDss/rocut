struct VertexOutput { @builtin(position) position: vec4f, @location(0) tex_coord: vec2f }
struct EffectUniforms {
    resolution: vec2f, clock_seed: vec2f, controls: vec4f,
    region: vec4f, mode: vec4f,
}
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var source_sampler: sampler;
@group(1) @binding(0) var<uniform> uniforms: EffectUniforms;

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let base = textureLoad(source, vec2i(input.position.xy), 0);
    let weight = uniforms.controls.x * region_weight(input.position.xy);
    if weight == 0.0 { return base; }
    if uniforms.controls.y == 1.0 && uniforms.controls.z == 0.0 && uniforms.controls.w == 0.0 {
        return base;
    }
    let refracted = lens_sample(input.position.xy, uniforms.controls.y);
    let result = mix(vec4f(base.rgb * base.a, base.a), refracted, weight);
    if result.a <= 0.000001 { return vec4f(0.0); }
    return vec4f(result.rgb / result.a, result.a);
}
