struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}
struct EffectUniforms {
    resolution: vec2f,
    tint_and_padding: vec2f,
    adjustments: vec4f,
}
@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;
@group(1) @binding(0) var<uniform> uniforms: EffectUniforms;

fn to_linear(rgb: vec3f) -> vec3f {
    return select(pow((rgb + vec3f(0.055)) / 1.055, vec3f(2.4)), rgb / 12.92, rgb <= vec3f(0.04045));
}
fn to_srgb(rgb: vec3f) -> vec3f {
    let safe = max(rgb, vec3f(0.0));
    return select(1.055 * pow(safe, vec3f(1.0 / 2.4)) - vec3f(0.055), 12.92 * safe, safe <= vec3f(0.0031308));
}
@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let source = textureSample(input_texture, input_sampler, input.tex_coord);
    if source.a <= 0.000001 { return vec4f(0.0); }
    let exposure = uniforms.adjustments.x;
    let contrast = 1.0 + uniforms.adjustments.y / 100.0;
    let saturation = 1.0 + uniforms.adjustments.z / 100.0;
    let temperature = uniforms.adjustments.w / 100.0;
    let tint = uniforms.tint_and_padding.x / 100.0;
    // Imported canvases use straight alpha; scene adjustments operate on the
    // opaque composite. Preserve alpha without multiplying the color twice.
    var color = clamp(source.rgb, vec3f(0.0), vec3f(1.0));
    let balance = vec3f(1.0 + 0.25 * temperature, 1.0 - 0.25 * tint, 1.0 - 0.25 * temperature);
    color = to_srgb(to_linear(color) * exp2(exposure) * balance);
    color = (color - vec3f(0.5)) * contrast + vec3f(0.5);
    let luminance = dot(color, vec3f(0.2126, 0.7152, 0.0722));
    color = mix(vec3f(luminance), color, saturation);
    return vec4f(clamp(color, vec3f(0.0), vec3f(1.0)), source.a);
}
