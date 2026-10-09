struct VertexOutput { @builtin(position) position: vec4f, @location(0) tex_coord: vec2f }
struct CloudsUniforms {
    geometry: vec4f,
    optics: vec4f,
    wind_color: vec4f,
    color_reserved: vec4f,
    lattice: array<vec4f, 256>,
}
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var source_sampler: sampler;
@group(1) @binding(0) var<uniform> uniforms: CloudsUniforms;

fn cloud_lattice(plane: u32, cell: vec2i) -> f32 {
    let index = plane * 256u + u32(cell.y & 15) * 16u + u32(cell.x & 15);
    return uniforms.lattice[index / 4u][index % 4u];
}

// Return value and analytic gradient with respect to this octave's coordinate.
fn cloud_octave(plane: u32, coordinate: vec2f) -> vec3f {
    let cell = vec2i(floor(coordinate));
    let part = fract(coordinate);
    let blend = part * part * (3.0 - 2.0 * part);
    let derivative = 6.0 * part * (1.0 - part);
    let a = cloud_lattice(plane, cell);
    let b = cloud_lattice(plane, cell + vec2i(1, 0));
    let c = cloud_lattice(plane, cell + vec2i(0, 1));
    let d = cloud_lattice(plane, cell + vec2i(1, 1));
    return vec3f(
        mix(mix(a, b, blend.x), mix(c, d, blend.x), blend.y),
        derivative.x * mix(b - a, d - c, blend.y),
        derivative.y * mix(c - a, d - b, blend.x));
}

fn cloud_field(plane: u32, q: vec2f) -> vec3f {
    let low = cloud_octave(plane, q);
    let mid = cloud_octave(plane, q * 2.0);
    let high = cloud_octave(plane, q * 4.0);
    // Chain factors produce derivatives with respect to dimensionless q.
    return low * (4.0 / 7.0)
        + mid * vec3f(2.0, 4.0, 4.0) / 7.0
        + high * vec3f(1.0, 4.0, 4.0) / 7.0;
}

fn cloud_tap(pixel: vec2i) -> vec4f {
    if any(pixel < vec2i(0)) || any(pixel >= vec2i(textureDimensions(source))) {
        return vec4f(0.0);
    }
    let color = textureLoad(source, pixel, 0);
    return vec4f(color.rgb * color.a, color.a);
}

fn cloud_sample(position: vec2f) -> vec4f {
    let p = position - 0.5;
    let pixel = vec2i(floor(p));
    let part = fract(p);
    return mix(
        mix(cloud_tap(pixel), cloud_tap(pixel + vec2i(1, 0)), part.x),
        mix(cloud_tap(pixel + vec2i(0, 1)), cloud_tap(pixel + vec2i(1, 1)), part.x), part.y);
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let position = input.position.xy;
    let base = textureLoad(source, vec2i(position), 0);
    let amount = uniforms.optics.x;
    let density = uniforms.optics.y;
    let refraction = uniforms.optics.z;
    let fog_opacity = uniforms.optics.w;
    if amount == 0.0 || density == 0.0 || (refraction == 0.0 && fog_opacity == 0.0) {
        return base;
    }
    let short_side = min(uniforms.geometry.x, uniforms.geometry.y);
    let q = ((position - uniforms.geometry.xy * 0.5) / short_side - uniforms.wind_color.xy) / uniforms.geometry.z;
    let cycle = uniforms.geometry.w * 4.0;
    let plane = u32(floor(cycle));
    let part = fract(cycle);
    let temporal = part * part * (3.0 - 2.0 * part);
    let field = mix(cloud_field(plane, q), cloud_field((plane + 1u) % 4u, q), temporal);
    let coverage = smoothstep(1.0 - density, 1.0 - density + 0.2, field.x);
    let weight = amount * coverage;
    var refracted = vec4f(base.rgb * base.a, base.a);
    if refraction != 0.0 && weight != 0.0 {
        let gradient = field.yz / max(1.0, length(field.yz));
        let displacement = -refraction * short_side * gradient;
        refracted = mix(refracted, cloud_sample(position + displacement), weight);
    }
    let fog_alpha = weight * fog_opacity;
    let color = vec3f(uniforms.wind_color.zw, uniforms.color_reserved.x);
    let premul = refracted.rgb * (1.0 - fog_alpha) + color * fog_alpha;
    let alpha = refracted.a * (1.0 - fog_alpha) + fog_alpha;
    if alpha <= 0.0 { return vec4f(0.0); }
    return vec4f(premul / alpha, alpha);
}
