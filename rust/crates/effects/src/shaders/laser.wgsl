struct VertexOutput { @builtin(position) position: vec4f, @location(0) tex_coord: vec2f }
struct LaserUniforms {
    resolution_direction: vec4f,
    controls: vec4f,
    color_glow: vec4f,
    padding: vec4f,
}
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var source_sampler: sampler;
@group(1) @binding(0) var<uniform> uniforms: LaserUniforms;

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let base = textureLoad(source, vec2i(input.position.xy), 0);
    let amount = uniforms.controls.x;
    let progress = uniforms.controls.y;
    if amount == 0.0 || progress == 1.0 { return base; }
    if base.a == 0.0 { return vec4f(0.0); }
    let size = uniforms.resolution_direction.xy;
    let direction = u32(uniforms.resolution_direction.z);
    var coordinate = input.position.x;
    var extent = size.x;
    if direction == 1u { coordinate = size.x - input.position.x; }
    if direction == 2u || direction == 3u {
        extent = size.y;
        coordinate = input.position.y;
        if direction == 3u { coordinate = size.y - input.position.y; }
    }
    let distance = progress * extent - coordinate;
    let width = uniforms.controls.z * min(size.x, size.y);
    let feather = width * uniforms.controls.w;
    var coverage = 0.0;
    var strength = 0.0;
    if progress > 0.0 && distance > 0.0 {
        coverage = 1.0;
        if feather > 0.0 { coverage = smoothstep(0.0, feather, distance); }
        if width > 0.0 {
            let core = 1.0 - smoothstep(0.0, width, distance);
            let halo = 0.35 * (1.0 - smoothstep(0.0, 3.0 * width, distance));
            strength = uniforms.color_glow.w * max(core, halo);
        }
    }
    // Emission is carried by revealed source coverage; a transparent hole does
    // not become an independently painted line or expose hidden source RGB.
    let lit = base.rgb + (vec3f(1.0) - base.rgb) * uniforms.color_glow.rgb * strength;
    let revealed = vec4f(lit * base.a * coverage, base.a * coverage);
    let result = mix(vec4f(base.rgb * base.a, base.a), revealed, amount);
    if result.a <= 0.5 / 255.0 { return vec4f(0.0); }
    return vec4f(result.rgb / result.a, result.a);
}
