@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    return wave_color(input.position.xy, false);
}
