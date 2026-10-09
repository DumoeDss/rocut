struct VertexOutput { @builtin(position) position: vec4f, @location(0) tex_coord: vec2f }
struct EffectUniforms { resolution: vec2f, clock_seed: vec2f, controls: vec4f, region: vec4f, color: vec4f }
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var source_sampler: sampler;
@group(1) @binding(0) var<uniform> uniforms: EffectUniforms;

fn glyph_bit(glyph: u32, pixel: vec2u) -> f32 {
    if pixel.x >= 5u || pixel.y >= 7u { return 0.0; }
    var rows = array<u32,70>(
        0u,0u,0u,0u,0u,0u,0u,
        0u,0u,0u,0u,0u,4u,0u,
        0u,0u,4u,0u,4u,0u,0u,
        0u,0u,0u,14u,0u,0u,0u,
        0u,0u,4u,14u,4u,0u,0u,
        0u,0u,14u,0u,14u,0u,0u,
        0u,17u,10u,4u,10u,17u,0u,
        0u,14u,17u,17u,17u,14u,0u,
        10u,31u,10u,10u,31u,10u,0u,
        14u,17u,23u,21u,23u,16u,15u
    );
    return f32((rows[glyph * 7u + pixel.y] >> (4u - pixel.x)) & 1u);
}

fn cell_random(cell: vec2u, seed: u32) -> f32 {
    var n = seed ^ (cell.x * 374761393u) ^ (cell.y * 668265263u);
    n = (n ^ (n >> 13u)) * 1274126177u;
    return f32(n ^ (n >> 16u)) / 4294967296.0;
}

fn decrypt_region(position: vec2f) -> f32 {
    let radius = uniforms.region.z * min(uniforms.resolution.x, uniforms.resolution.y);
    if radius <= 0.0 { return 0.0; }
    let distance = length(position - uniforms.region.xy * uniforms.resolution);
    if distance >= radius { return 0.0; }
    if uniforms.region.w == 0.0 { return 1.0; }
    return 1.0 - smoothstep(radius * (1.0 - uniforms.region.w), radius, distance);
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let base = textureLoad(source, vec2i(input.position.xy), 0);
    let amount = uniforms.controls.x;
    if amount == 0.0 { return base; }
    if base.a == 0.0 { return vec4f(0.0); }
    let size = vec2f(uniforms.controls.z, uniforms.controls.z * (8.0 / 6.0));
    let cell = floor(input.position.xy / size);
    let origin = cell * size;
    let random = cell_random(vec2u(cell), u32(uniforms.clock_seed.y));
    let threshold = 0.15 + 0.7 * random;
    let revealed = decrypt_region(input.position.xy)
        * smoothstep(threshold - 0.075, threshold + 0.075, uniforms.controls.y);
    if revealed == 1.0 { return base; }
    var premultiplied = vec3f(0.0);
    var alpha = 0.0;
    for (var y=0; y<4; y++) {
        for (var x=0; x<4; x++) {
            let position = origin + (vec2f(f32(x),f32(y))+0.5) * size / 4.0;
            if all(position < uniforms.resolution) {
                let sample = textureLoad(source, vec2i(position), 0);
                premultiplied += sample.rgb * sample.a;
                alpha += sample.a;
            }
        }
    }
    let rgb = premultiplied / max(alpha, 0.000001);
    let luminance = dot(rgb, vec3f(0.2126,0.7152,0.0722));
    let density = clamp((luminance - 0.5) * uniforms.controls.w + 0.5 + (random - 0.5) * 0.05, 0.0, 1.0);
    let glyph = min(u32(density * 10.0), 9u);
    let pixel = vec2u(floor((input.position.xy - origin) / size * vec2f(6.0,8.0)));
    let characters = uniforms.color.rgb * glyph_bit(glyph, pixel);
    // Both domains keep the source pixel's alpha; glyph gutters do not cut holes.
    // Equal coverage cancels from premultiplied interpolation, so RGB does not
    // need an additional multiply/divide by alpha.
    var effect_rgb = characters;
    if revealed > 0.0 { effect_rgb = mix(characters, base.rgb, revealed); }
    if amount == 1.0 { return vec4f(effect_rgb, base.a); }
    return vec4f(mix(base.rgb, effect_rgb, amount), base.a);
}
