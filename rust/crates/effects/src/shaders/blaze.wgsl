struct VertexOutput { @builtin(position) position: vec4f, @location(0) tex_coord: vec2f }
struct BlazeUniforms {
    geometry: vec4f,
    controls: vec4f,
    motion: vec4f,
    lattice: array<vec4f, 64>,
    sparks: array<vec4f, 24>,
}
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var source_sampler: sampler;
@group(1) @binding(0) var<uniform> uniforms: BlazeUniforms;

fn blaze_lattice(plane: u32, cell: vec2i) -> f32 {
    let index = plane * 64u + u32(cell.y & 7) * 8u + u32(cell.x & 7);
    return uniforms.lattice[index / 4u][index % 4u];
}

// Value and analytic derivatives with respect to the octave coordinates.
fn blaze_octave(plane: u32, coordinate: vec2f) -> vec3f {
    let cell = vec2i(floor(coordinate));
    let part = fract(coordinate);
    let blend = part * part * (3.0 - 2.0 * part);
    let derivative = 6.0 * part * (1.0 - part);
    let a = blaze_lattice(plane, cell);
    let b = blaze_lattice(plane, cell + vec2i(1, 0));
    let c = blaze_lattice(plane, cell + vec2i(0, 1));
    let d = blaze_lattice(plane, cell + vec2i(1, 1));
    return vec3f(
        mix(mix(a, b, blend.x), mix(c, d, blend.x), blend.y),
        derivative.x * mix(b - a, d - c, blend.y),
        derivative.y * mix(c - a, d - b, blend.x));
}

fn blaze_plane(plane: u32, coordinate: vec2f) -> vec3f {
    return blaze_octave(plane, coordinate) * (2.0 / 3.0)
        + blaze_octave(plane, coordinate * 2.0) * vec3f(1.0, 2.0, 2.0) / 3.0;
}

fn blaze_field(coordinate: vec2f) -> vec3f {
    let cycle = uniforms.motion.x * 4.0;
    let plane = u32(floor(cycle));
    let part = fract(cycle);
    let blend = part * part * (3.0 - 2.0 * part);
    return mix(blaze_plane(plane, coordinate), blaze_plane((plane + 1u) % 4u, coordinate), blend);
}

fn blaze_tap(pixel: vec2i) -> vec4f {
    if any(pixel < vec2i(0)) || any(pixel >= vec2i(textureDimensions(source))) {
        return vec4f(0.0);
    }
    let color = textureLoad(source, pixel, 0);
    return vec4f(color.rgb * color.a, color.a);
}

fn blaze_sample(position: vec2f) -> vec4f {
    let p = position - 0.5;
    let pixel = vec2i(floor(p));
    let part = fract(p);
    return mix(
        mix(blaze_tap(pixel), blaze_tap(pixel + vec2i(1, 0)), part.x),
        mix(blaze_tap(pixel + vec2i(0, 1)), blaze_tap(pixel + vec2i(1, 1)), part.x), part.y);
}

fn blaze_over(bottom: vec4f, color: vec3f, alpha: f32) -> vec4f {
    return vec4f(color * alpha, alpha) + bottom * (1.0 - alpha);
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let position = input.position.xy;
    let base = textureLoad(source, vec2i(position), 0);
    let amount = uniforms.controls.x;
    let refraction = uniforms.motion.z;
    if amount == 0.0 || (all(uniforms.controls.yzw == vec3f(0.0)) && refraction == 0.0) {
        return base;
    }
    let resolution = uniforms.geometry.xy;
    let short_side = min(resolution.x, resolution.y);
    let emission_height = uniforms.geometry.z * short_side;
    let rise = resolution.y - position.y;
    let u = rise / emission_height;
    let wind = uniforms.motion.y;
    let coordinate = vec2f(
        (position.x / short_side - wind * u) / uniforms.geometry.w,
        rise / (short_side * uniforms.geometry.w) - 8.0 * uniforms.motion.x);
    let field = blaze_field(coordinate);
    let flame = (1.0 - smoothstep(0.65, 1.0, u))
        * smoothstep(0.25 + 0.5 * u, 0.45 + 0.5 * u, field.x);
    let flame_alpha = amount * uniforms.controls.y * flame;
    let core = clamp((field.x - 0.35) / 0.5, 0.0, 1.0) * max(1.0 - u, 0.0);
    let flame_color = mix(vec3f(1.0, 0.12, 0.015), vec3f(1.0, 0.9, 0.25), core);
    var smoke_alpha = 0.0;
    if uniforms.controls.w != 0.0 {
        // Same periodic coordinate scale keeps the phase wrap continuous.
        let smoke = blaze_field(coordinate + vec2f(2.375, 4.625)).x;
        smoke_alpha = amount * uniforms.controls.w * smoothstep(0.1, 0.45, u)
            * (1.0 - smoothstep(1.2, 2.0, u)) * smoothstep(0.3, 0.7, smoke);
    }
    var sparks = 0.0;
    if uniforms.controls.z != 0.0 {
        for (var i = 0u; i < 24u; i += 1u) {
            let spark = uniforms.sparks[i];
            let age = spark.y;
            let center = vec2f(
                spark.x * resolution.x + wind * short_side * age
                    + spark.w * short_side * 0.03 * age * (1.0 - age),
                resolution.y - age * 1.8 * emission_height);
            let q = (position - center) / (spark.z * short_side * vec2f(1.0, 2.5));
            let footprint = max(1.0 - dot(q, q), 0.0);
            sparks = max(sparks, footprint * footprint * 4.0 * age * (1.0 - age));
        }
    }
    let spark_alpha = amount * uniforms.controls.z * sparks;
    let heat = smoothstep(0.0, 0.15, u) * (1.0 - smoothstep(0.8, 1.5, u));
    let gradient = field.yz / max(1.0, length(field.yz));
    let displacement = refraction * short_side * heat * vec2f(gradient.x, -gradient.y);
    if all(displacement == vec2f(0.0)) && flame_alpha == 0.0 && smoke_alpha == 0.0 && spark_alpha == 0.0 {
        return base;
    }
    var result = vec4f(base.rgb * base.a, base.a);
    if any(displacement != vec2f(0.0)) {
        result = mix(result, blaze_sample(position + displacement), amount);
    }
    result = blaze_over(result, vec3f(0.16, 0.18, 0.20), smoke_alpha);
    result = blaze_over(result, flame_color, flame_alpha);
    result = blaze_over(result, vec3f(1.0, 0.75, 0.25), spark_alpha);
    if result.a <= 0.0 { return vec4f(0.0); }
    return vec4f(result.rgb / result.a, result.a);
}
