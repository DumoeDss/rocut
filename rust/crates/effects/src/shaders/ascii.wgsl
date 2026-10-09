// 5x7 bitmap glyphs and luminance-cell rasterizer; no external font is needed.
// Source is straight-alpha RGBA, like the other
// native effects; average/interpolate in premultiplied form to avoid dark fringes.
struct VertexOutput { @builtin(position) position: vec4f, @location(0) tex_coord: vec2f }
struct EffectUniforms { resolution: vec2f, clock_seed: vec2f, controls: vec4f, region: vec4f, mode: vec4f }
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var source_sampler: sampler;
@group(1) @binding(0) var<uniform> uniforms: EffectUniforms;

fn glyph_bit(glyph: u32, pixel: vec2u) -> f32 {
    if pixel.x >= 5u || pixel.y >= 7u { return 0.0; }
    // ASCII ramp: space . : - + = x o # @
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
@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let base = textureSampleLevel(source, source_sampler, input.tex_coord, 0.0);
    let amount = uniforms.controls.x * region_weight(input.position.xy);
    if amount == 0.0 { return base; }
    let size = vec2f(uniforms.controls.y, uniforms.controls.y * (8.0 / 6.0));
    let cell = floor(input.position.xy / size);
    let origin = cell * size;
    var premultiplied = vec3f(0.0);
    var alpha = 0.0;
    for (var y=0; y<4; y++) {
        for (var x=0; x<4; x++) {
            let position = origin + (vec2f(f32(x),f32(y))+0.5) * size / 4.0;
            if all(position < uniforms.resolution) {
                let sample = textureSampleLevel(source, source_sampler, position / uniforms.resolution, 0.0);
                premultiplied += sample.rgb * sample.a;
                alpha += sample.a;
            }
        }
    }
    let rgb = premultiplied / max(alpha, 0.000001);
    let luminance = dot(rgb,vec3f(0.2126,0.7152,0.0722));
    let jitter = (cell_random(vec2u(cell),u32(uniforms.clock_seed.y))-0.5)*0.05;
    let density = clamp((luminance-0.5)*uniforms.controls.z+0.5+jitter,0.0,1.0);
    let glyph = min(u32(density*10.0),9u);
    let pixel = vec2u(floor((input.position.xy-origin) / size * vec2f(6.0,8.0)));
    let coverage = glyph_bit(glyph,pixel) * alpha / 16.0;
    let color = mix(vec3f(1.0),rgb,uniforms.controls.w);
    let out_alpha = mix(base.a,coverage,amount);
    let out_rgb = mix(base.rgb*base.a,color*coverage,amount);
    if out_alpha <= 0.000001 { return vec4f(0.0); }
    return vec4f(out_rgb / out_alpha,out_alpha);
}
