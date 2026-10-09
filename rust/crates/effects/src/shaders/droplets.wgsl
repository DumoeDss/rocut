struct VertexOutput { @builtin(position) position: vec4f, @location(0) tex_coord: vec2f }
struct DropletsUniforms {
    resolution_count: vec4f,
    controls: vec4f,
    drops: array<vec4f, 64>,
}
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var source_sampler: sampler;
@group(1) @binding(0) var<uniform> uniforms: DropletsUniforms;

fn droplet_tap(pixel: vec2i) -> vec4f {
    if any(pixel < vec2i(0)) || any(pixel >= vec2i(textureDimensions(source))) {
        return vec4f(0.0);
    }
    let color = textureLoad(source, pixel, 0);
    return vec4f(color.rgb * color.a, color.a);
}

fn droplet_sample(position: vec2f) -> vec4f {
    let p = position - 0.5;
    let pixel = vec2i(floor(p));
    let part = fract(p);
    return mix(
        mix(droplet_tap(pixel), droplet_tap(pixel + vec2i(1, 0)), part.x),
        mix(droplet_tap(pixel + vec2i(0, 1)), droplet_tap(pixel + vec2i(1, 1)), part.x), part.y);
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let position = input.position.xy;
    let base = textureLoad(source, vec2i(position), 0);
    let amount = uniforms.controls.x;
    let refraction = uniforms.controls.y;
    let highlight = uniforms.controls.z;
    if amount == 0.0 || uniforms.resolution_count.z == 0.0 || (refraction == 0.0 && highlight == 0.0) {
        return base;
    }
    let resolution = uniforms.resolution_count.xy;
    let short_side = min(resolution.x, resolution.y);
    var envelope = 0.0;
    var coordinate = vec2f(0.0);
    for (var i = 0u; i < u32(uniforms.resolution_count.z); i += 1u) {
        let drop = uniforms.drops[i];
        let rx = drop.z * short_side;
        let ry = rx * drop.w;
        let center = vec2f(drop.x * resolution.x, -ry + drop.y * (resolution.y + 2.0 * ry));
        let q = (position - center) / vec2f(rx, ry);
        let distance_squared = dot(q, q);
        if distance_squared >= 1.0 { continue; }
        let bump = 1.0 - distance_squared;
        let weight = bump * bump;
        // Independent lens footprints do not merge or amplify each other.
        // Ascending indices and strict comparison break equal-weight ties.
        if weight > envelope {
            envelope = weight;
            coordinate = q;
        }
    }
    if envelope == 0.0 { return base; }
    let displacement = -coordinate * envelope * refraction * short_side;
    var result = vec4f(base.rgb * base.a, base.a);
    if any(displacement != vec2f(0.0)) {
        result = mix(result, droplet_sample(position + displacement), amount);
    }
    let spot = max(0.0, 1.0 - length(coordinate - vec2f(-0.35)) / 0.30);
    let light = amount * highlight * envelope * spot * spot;
    result = vec4f(mix(result.rgb, vec3f(result.a), light), result.a);
    if result.a <= 0.5 / 255.0 { return vec4f(0.0); }
    return vec4f(result.rgb / result.a, result.a);
}
