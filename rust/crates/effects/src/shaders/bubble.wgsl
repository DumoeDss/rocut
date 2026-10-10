struct VertexOutput { @builtin(position) position: vec4f, @location(0) tex_coord: vec2f }
// Eight vec4 headers and 24 vec4 centers: Rust packs exactly 512 bytes.
struct BubbleUniforms {
    geometry: vec4f, // width, height, short side, amount
    field: vec4f, // radius, exponent, epsilon squared, radius squared + epsilon squared
    optics: vec4f, // signed plane distance in pixels, IOR, dispersion, frost spacing in pixels
    decoration: vec4f, // shine, rim attenuation, iridescence, intensity
    tint: vec4f,
    color_a: vec4f, // RGB, periodic elapsed sheen phase
    color_b: vec4f, // RGB, active ball count
    bounds: vec4f, // conservative short-side min/max, expanded by radius + 2 pixels
    centers: array<vec4f, 24>,
}
struct BubbleField { normal: vec3f, height: f32, signed_distance: f32 }
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var source_sampler: sampler;
@group(1) @binding(0) var<uniform> uniforms: BubbleUniforms;

fn bubble_normalize(value: vec3f) -> vec3f {
    let scale = max(max(abs(value.x), abs(value.y)), abs(value.z));
    if scale == 0.0 { return vec3f(0.0, 0.0, 1.0); }
    let scaled = value / scale;
    return scaled / length(scaled);
}

fn bubble_field(point: vec2f) -> BubbleField {
    let count = u32(uniforms.color_b.w);
    let exponent = uniforms.field.y;
    let epsilon_squared = uniforms.field.z;
    let scale_squared = uniforms.field.w;
    var terms: array<vec3f, 24>;
    var maximum = -1.0e20;
    // One bounded term per active center; retain log term and analytic gradient.
    for (var index = 0u; index < count; index += 1u) {
        let delta = point - uniforms.centers[index].xy;
        let denominator = dot(delta, delta) + epsilon_squared;
        let log_term = exponent * (log(scale_squared) - log(denominator));
        terms[index] = vec3f(log_term, -2.0 * exponent * delta / denominator);
        maximum = max(maximum, log_term);
    }
    var total = 0.0;
    var gradient = vec2f(0.0);
    for (var index = 0u; index < count; index += 1u) {
        let weight = exp(terms[index].x - maximum);
        total += weight;
        gradient += weight * terms[index].yz;
    }
    gradient /= total;
    // Dividing by N is essential: coincident balls keep radius R for all N.
    let log_field = maximum + log(total / f32(count));
    let inverse = exp(-max(log_field, 0.0) / exponent);
    let height = sqrt(max(0.0, scale_squared * (1.0 - inverse)));
    let normal_factor = scale_squared * inverse / (2.0 * exponent);
    let normal = bubble_normalize(vec3f(-normal_factor * gradient, height));
    let gradient_scale = max(abs(gradient.x), abs(gradient.y));
    var gradient_length = 0.0;
    if gradient_scale != 0.0 { gradient_length = gradient_scale * length(gradient / gradient_scale); }
    return BubbleField(normal, height, log_field / max(gradient_length, 1.0e-6));
}

// The pipeline stores straight RGBA. Premultiply each texel before interpolating;
// out-of-bounds texels are transparent black, never clamped edge colors.
fn bubble_tap(pixel: vec2i) -> vec4f {
    if any(pixel < vec2i(0)) || any(pixel >= vec2i(textureDimensions(source))) { return vec4f(0.0); }
    let value = textureLoad(source, pixel, 0);
    return vec4f(value.rgb * value.a, value.a);
}

fn bubble_sample(position: vec2f) -> vec4f {
    let pixel_position = position - 0.5;
    let pixel = vec2i(floor(pixel_position));
    let part = fract(pixel_position);
    return mix(
        mix(bubble_tap(pixel), bubble_tap(pixel + vec2i(1, 0)), part.x),
        mix(bubble_tap(pixel + vec2i(0, 1)), bubble_tap(pixel + vec2i(1, 1)), part.x), part.y);
}

fn bubble_frost(position: vec2f) -> vec4f {
    let spacing = uniforms.optics.w;
    if spacing == 0.0 { return bubble_sample(position); }
    var result = vec4f(0.0);
    for (var y = -1; y <= 1; y += 1) {
        for (var x = -1; x <= 1; x += 1) {
            let weight = select(1.0, 2.0, x == 0) * select(1.0, 2.0, y == 0) / 16.0;
            result += weight * bubble_sample(position + vec2f(f32(x), f32(y)) * spacing);
        }
    }
    return result;
}

fn bubble_refraction(normal: vec3f, ior: f32) -> vec2f {
    let eta = 1.0 / ior;
    let eta_squared = eta * eta;
    // Both terms stay nonnegative for IOR >= 1. Avoid cancelling normal.z^2
    // against one near the silhouette, especially for identity refraction.
    let k = (1.0 - eta_squared) + eta_squared * (normal.z * normal.z);
    let factor = eta * normal.z - sqrt(max(0.0, k));
    let transmitted = vec3f(factor * normal.xy, -eta + factor * normal.z);
    return uniforms.optics.x * transmitted.xy / -transmitted.z;
}

fn bubble_optical(position: vec2f, normal: vec3f) -> vec4f {
    let ior = uniforms.optics.y;
    let dispersion = uniforms.optics.z;
    let green = bubble_frost(position + bubble_refraction(normal, ior));
    if dispersion == 0.0 { return green; }
    let red = bubble_frost(position + bubble_refraction(normal, max(1.0, ior - 0.015 * dispersion)));
    let blue = bubble_frost(position + bubble_refraction(normal, max(1.0, ior + 0.015 * dispersion)));
    return vec4f(red.r, green.g, blue.b, max(max(red.a, green.a), blue.a));
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let position = input.position.xy;
    let base = textureLoad(source, vec2i(position), 0);
    let amount = uniforms.geometry.w;
    let neutral_refraction = uniforms.optics.x == 0.0 || (uniforms.optics.y == 1.0 && uniforms.optics.z == 0.0);
    if amount == 0.0 || (neutral_refraction && uniforms.optics.w == 0.0
        && all(uniforms.decoration.xyz == vec3f(0.0)) && uniforms.tint.w == 0.0) { return base; }
    let point = position / uniforms.geometry.z;
    if any(point < uniforms.bounds.xy) || any(point > uniforms.bounds.zw) { return base; }
    let field = bubble_field(point);
    let edge = clamp(field.signed_distance * uniforms.geometry.z + 0.5, 0.0, 1.0);
    let coverage = edge * edge * (3.0 - 2.0 * edge);
    let mix_amount = amount * coverage;
    if mix_amount == 0.0 { return base; }
    let optical = bubble_optical(position, field.normal);
    let rim_distance = 1.0 - field.normal.z;
    let rim = 1.0 - uniforms.decoration.y * rim_distance * rim_distance * rim_distance;
    let light = bubble_normalize(vec3f(-0.45, -0.55, 0.7));
    let half_vector = bubble_normalize(light + vec3f(0.0, 0.0, 1.0));
    let shine = uniforms.decoration.x * pow(max(dot(field.normal, half_vector), 0.0), 48.0);
    let phase = 6.283185307179586 * (uniforms.color_a.w + 0.7 * field.normal.x
        + 0.4 * field.normal.y + 0.25 * field.height / uniforms.field.x);
    let cycle = 0.5 + 0.5 * sin(phase);
    let sheen_strength = clamp(uniforms.decoration.w * cycle, 0.0, 1.0);
    let sheen = 0.2 * uniforms.decoration.z * sheen_strength * sheen_strength * sheen_strength;
    let color = mix(uniforms.color_a.rgb, uniforms.color_b.rgb, cycle);
    let tinted = optical.rgb * mix(vec3f(1.0), uniforms.tint.rgb, uniforms.tint.w) * rim;
    let decorated = clamp(tinted + optical.a * (vec3f(shine) + sheen * color), vec3f(0.0), vec3f(optical.a));
    let result = mix(vec4f(base.rgb * base.a, base.a), vec4f(decorated, optical.a), mix_amount);
    // Computed zero-alpha RGBA8 pixels cannot preserve poisoned hidden RGB.
    // Identity branches above do preserve original bytes, including hidden RGB.
    if floor(result.a * 255.0 + 0.5) == 0.0 { return vec4f(0.0); }
    return vec4f(clamp(result.rgb / result.a, vec3f(0.0), vec3f(1.0)), result.a);
}
