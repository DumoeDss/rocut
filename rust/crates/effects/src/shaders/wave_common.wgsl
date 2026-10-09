struct VertexOutput { @builtin(position) position: vec4f, @location(0) tex_coord: vec2f }
struct WaveUniforms {
    resolution_count: vec4f,
    controls: vec4f,
    timing: vec4f,
    color_glow: vec4f,
    events: array<vec4f, 16>,
}
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var source_sampler: sampler;
@group(1) @binding(0) var<uniform> uniforms: WaveUniforms;

fn wave_tap(pixel: vec2i) -> vec4f {
    if any(pixel < vec2i(0)) || any(pixel >= vec2i(textureDimensions(source))) {
        return vec4f(0.0);
    }
    let color = textureLoad(source, pixel, 0);
    return vec4f(color.rgb * color.a, color.a);
}
fn wave_sample(position: vec2f) -> vec4f {
    let p = position - 0.5;
    let pixel = vec2i(floor(p));
    let part = fract(p);
    return mix(
        mix(wave_tap(pixel), wave_tap(pixel + vec2i(1, 0)), part.x),
        mix(wave_tap(pixel + vec2i(0, 1)), wave_tap(pixel + vec2i(1, 1)), part.x), part.y);
}

// xy is the summed radial displacement in short-side units; zw is ring/halo energy.
fn wave_field(position: vec2f) -> vec4f {
    let resolution = uniforms.resolution_count.xy;
    let short_side = min(resolution.x, resolution.y);
    let speed = uniforms.controls.y;
    let wavelength = uniforms.controls.z;
    let width = uniforms.controls.w;
    let lifetime = uniforms.timing.z;
    var field = vec4f(0.0);
    for (var i = 0u; i < u32(uniforms.resolution_count.z); i += 1u) {
        let event = uniforms.events[i];
        let age = event.z;
        if age <= 0.0 || age >= lifetime || event.w == 0.0 { continue; }
        let delta = (position - event.xy * resolution) / short_side;
        let distance = length(delta);
        let offset = distance - speed * age;
        if abs(offset) >= width { continue; }
        let coordinate = offset / width;
        let bump = max(0.0, 1.0 - coordinate * coordinate);
        let envelope = bump * bump;
        let tail = 1.0 - age / lifetime;
        let onset = smoothstep(0.0, min(0.1, lifetime * 0.1), age);
        let temporal = onset * tail * tail * exp(-uniforms.timing.y * age);
        let oscillation = sin(6.283185307179586 * offset / wavelength);
        // At the exact center the radial direction has no unique value.
        if distance > 0.000001 {
            field.x += delta.x / distance * event.w * temporal * envelope * oscillation;
            field.y += delta.y / distance * event.w * temporal * envelope * oscillation;
        }
        let energy = abs(event.w) * temporal;
        field.z += energy * envelope * envelope * envelope * envelope;
        field.w += energy * envelope;
    }
    return field;
}

fn wave_color(position: vec2f, force_field: bool) -> vec4f {
    let base = textureLoad(source, vec2i(position), 0);
    let amount = uniforms.controls.x;
    if amount == 0.0 || uniforms.resolution_count.z == 0.0 { return base; }
    let field = wave_field(position);
    let displacement = field.xy * uniforms.timing.x * min(uniforms.resolution_count.x, uniforms.resolution_count.y);
    var coverage = 0.0;
    if force_field {
        let energy = field.z * uniforms.timing.w + field.w * uniforms.color_glow.w * 0.25;
        coverage = (1.0 - exp(-energy)) * amount;
    }
    if all(displacement == vec2f(0.0)) && coverage == 0.0 { return base; }
    let premultiplied = vec4f(base.rgb * base.a, base.a);
    var result = premultiplied;
    if any(displacement != vec2f(0.0)) {
        result = mix(premultiplied, wave_sample(position + displacement), amount);
    }
    result = vec4f(uniforms.color_glow.rgb * coverage + result.rgb * (1.0 - coverage),
        coverage + result.a * (1.0 - coverage));
    // The render target is RGBA8: discard RGB when coverage quantizes to zero.
    if result.a <= 0.5 / 255.0 { return vec4f(0.0); }
    return vec4f(result.rgb / result.a, result.a);
}
