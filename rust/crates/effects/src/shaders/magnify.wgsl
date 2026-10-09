struct VertexOutput { @builtin(position) position: vec4f, @location(0) tex_coord: vec2f }
struct EffectUniforms {
    resolution: vec2f, clock_seed: vec2f, controls: vec4f,
    region: vec4f, mode: vec4f,
}
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var source_sampler: sampler;
@group(1) @binding(0) var<uniform> uniforms: EffectUniforms;

fn stroke(distance: f32) -> f32 {
    return 1.0 - smoothstep(uniforms.mode.w * 0.5, uniforms.mode.w * 0.5 + 1.0, distance);
}
fn hud_coverage(delta: vec2f, radius: f32, pulse: f32) -> f32 {
    let distance = length(delta);
    let rim = stroke(abs(distance - radius * 0.9));
    let cross = stroke(min(abs(delta.x), abs(delta.y)))
        * step(radius * 0.04, distance) * (1.0 - step(radius * 0.15, distance));
    let angle = atan2(delta.y, delta.x);
    let ticks = stroke(abs(sin(angle * 8.0)) * distance)
        * step(radius * 0.76, distance) * (1.0 - step(radius * 0.87, distance));
    let shock = stroke(abs(distance - radius * (0.45 + 0.4 * pulse))) * pulse;
    return max(max(rim, cross), max(ticks, shock));
}
@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let base = textureLoad(source, vec2i(input.position.xy), 0);
    let weight = uniforms.controls.x * region_weight(input.position.xy);
    if weight == 0.0 { return base; }
    let pulse = uniforms.mode.z;
    let zoom = min(8.0, uniforms.controls.y * (1.0 + 0.35 * pulse));
    let neutral = zoom == 1.0 && uniforms.controls.z == 0.0 && uniforms.controls.w == 0.0;
    if neutral && uniforms.mode.y == 0.0 { return base; }
    let premultiplied = vec4f(base.rgb * base.a, base.a);
    var optical = premultiplied;
    if !neutral { optical = lens_sample(input.position.xy, zoom); }
    var result = mix(premultiplied, optical, weight);
    let radius = uniforms.region.z * min(uniforms.resolution.x, uniforms.resolution.y);
    let delta = input.position.xy - uniforms.region.xy * uniforms.resolution;
    let coverage = hud_coverage(delta, radius, pulse) * uniforms.mode.y * weight;
    let color = mix(vec3f(0.15, 0.85, 1.0), vec3f(1.0, 0.95, 0.65), pulse);
    result = vec4f(color * coverage + result.rgb * (1.0 - coverage),
        coverage + result.a * (1.0 - coverage));
    if result.a <= 0.000001 { return vec4f(0.0); }
    return vec4f(result.rgb / result.a, result.a);
}
