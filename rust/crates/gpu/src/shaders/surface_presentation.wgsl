struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;

// Only presentation to a premultiplied surface uses this conversion. All
// effect/compositor intermediates and the generic blit retain straight RGBA.
@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let color = textureSample(input_texture, input_sampler, input.tex_coord);
    return vec4f(color.rgb * color.a, color.a);
}
