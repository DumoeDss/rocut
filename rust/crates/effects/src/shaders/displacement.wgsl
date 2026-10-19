struct VertexOutput { @builtin(position) position: vec4f, @location(0) tex_coord: vec2f }
struct EffectUniforms {
    resolution: vec2f, clock_seed: vec2f, controls: vec4f,
    region: vec4f, mode: vec4f,
}
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var source_sampler: sampler;
@group(1) @binding(0) var<uniform> uniforms: EffectUniforms;

fn displacement_hash(cell: vec2u) -> u32 {
    var value = (cell.x * 1597334677u) ^ (cell.y * 3812015801u) ^ (u32(uniforms.clock_seed.y) * 2798796415u);
    value = (value ^ (value >> 16u)) * 2246822519u;
    value = (value ^ (value >> 13u)) * 3266489917u;
    return value ^ (value >> 16u);
}

fn displacement_vertex(cell: vec2u) -> vec2f {
    let bits = displacement_hash(cell);
    let value = vec2f(f32(bits & 65535u), f32(bits >> 16u)) / 32767.5 - 1.0;
    // Unit-disc vertices keep interpolated offsets within the authored distance.
    return value / max(1.0, length(value));
}

fn displacement_field(position: vec2f) -> vec2f {
    let grid = position / uniforms.controls.z;
    let cell = vec2u(floor(grid));
    let fraction = fract(grid);
    let blend = fraction * fraction * (3.0 - 2.0 * fraction);
    return mix(
        mix(displacement_vertex(cell), displacement_vertex(cell + vec2u(1u, 0u)), blend.x),
        mix(displacement_vertex(cell + vec2u(0u, 1u)), displacement_vertex(cell + vec2u(1u, 1u)), blend.x),
        blend.y);
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let position = input.position.xy;
    let base = textureLoad(source, vec2i(position), 0);
    let weight = uniforms.controls.x * region_weight(position);
    if weight == 0.0 || uniforms.controls.y == 0.0 { return base; }
    let offset = displacement_field(position) * uniforms.controls.y * min(uniforms.resolution.x, uniforms.resolution.y);
    let green = sample_premultiplied(position + offset);
    var displaced = green;
    if uniforms.controls.w > 0.0 {
        let red = sample_premultiplied(position + offset * (1.0 + uniforms.controls.w));
        let blue = sample_premultiplied(position + offset * (1.0 - uniforms.controls.w));
        displaced = vec4f(red.r, green.g, blue.b, max(red.a, max(green.a, blue.a)));
    }
    let result = mix(vec4f(base.rgb * base.a, base.a), displaced, weight);
    if result.a <= 0.000001 { return vec4f(0.0); }
    return vec4f(result.rgb / result.a, result.a);
}
