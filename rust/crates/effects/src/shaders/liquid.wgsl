struct VertexOutput { @builtin(position) position: vec4f, @location(0) tex_coord: vec2f }
struct LiquidUniforms {
    resolution_grid: vec4f,
    optics: vec4f,
    color: vec4f,
}
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var source_sampler: sampler;
@group(1) @binding(0) var<uniform> uniforms: LiquidUniforms;
@group(1) @binding(1) var cells: texture_2d<f32>;

fn grid_tap(cell: vec2i) -> vec4f {
    let dimensions = vec2i(uniforms.resolution_grid.zw);
    let index = clamp(cell, vec2i(0), dimensions - 1);
    return textureLoad(cells, index, 0);
}
fn flow(position: vec2f) -> vec4f {
    let p = position / uniforms.resolution_grid.xy * uniforms.resolution_grid.zw - 0.5;
    let cell = vec2i(floor(p));
    let part = fract(p);
    return mix(mix(grid_tap(cell), grid_tap(cell + vec2i(1,0)), part.x),
        mix(grid_tap(cell + vec2i(0,1)), grid_tap(cell + vec2i(1,1)), part.x), part.y);
}
fn source_tap(pixel: vec2i) -> vec4f {
    if any(pixel < vec2i(0)) || any(pixel >= vec2i(textureDimensions(source))) { return vec4f(0.0); }
    let color = textureLoad(source, pixel, 0);
    return vec4f(color.rgb * color.a, color.a);
}
fn source_sample(position: vec2f) -> vec4f {
    let p = position - 0.5;
    let pixel = vec2i(floor(p));
    let part = fract(p);
    return mix(mix(source_tap(pixel), source_tap(pixel + vec2i(1,0)), part.x),
        mix(source_tap(pixel + vec2i(0,1)), source_tap(pixel + vec2i(1,1)), part.x), part.y);
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let base = textureLoad(source, vec2i(input.position.xy), 0);
    let field = flow(input.position.xy);
    let amount = uniforms.optics.x;
    if amount == 0.0 || (all(field.xy == vec2f(0.0)) && field.z == 0.0) { return base; }
    let short_side = min(uniforms.resolution_grid.x, uniforms.resolution_grid.y);
    let speed_scale = max(abs(field.x), abs(field.y));
    var direction = vec2f(0.0);
    if speed_scale > 0.0 {
        let scaled = field.xy / speed_scale;
        direction = scaled / (1.0 / speed_scale + length(scaled));
    }
    let refracted = source_sample(input.position.xy + direction * uniforms.optics.y * short_side);
    let dye = (1.0 - exp(-field.z)) * uniforms.optics.z;
    let dyed = vec4f(mix(refracted.rgb, uniforms.color.rgb * refracted.a, dye), refracted.a);
    let result = mix(vec4f(base.rgb * base.a, base.a), dyed, amount);
    if result.a <= 0.5 / 255.0 { return vec4f(0.0); }
    return vec4f(result.rgb / result.a, result.a);
}
