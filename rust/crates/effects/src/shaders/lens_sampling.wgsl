// Texture data is straight-alpha. Interpolate premultiplied taps explicitly so
// hidden RGB in transparent texels cannot leak into a refracted edge.
fn tap(pixel: vec2i) -> vec4f {
    if any(pixel < vec2i(0)) || any(pixel >= vec2i(textureDimensions(source))) {
        return vec4f(0.0);
    }
    let color = textureLoad(source, pixel, 0);
    return vec4f(color.rgb * color.a, color.a);
}
fn sample_premultiplied(position: vec2f) -> vec4f {
    let p = position - 0.5;
    let pixel = vec2i(floor(p));
    let part = fract(p);
    return mix(
        mix(tap(pixel), tap(pixel + vec2i(1,0)), part.x),
        mix(tap(pixel + vec2i(0,1)), tap(pixel + vec2i(1,1)), part.x), part.y);
}
fn lens_sample(position: vec2f, zoom: f32) -> vec4f {
    let center = uniforms.region.xy * uniforms.resolution;
    let radius = uniforms.region.z * min(uniforms.resolution.x, uniforms.resolution.y);
    let delta = position - center;
    let dome = sqrt(max(0.0, 1.0 - dot(delta, delta) / (radius * radius)));
    let displaced = delta / (zoom * (1.0 + uniforms.controls.z * dome));
    let green = sample_premultiplied(center + displaced);
    var refracted = green;
    if uniforms.controls.w > 0.0 {
        let separation = uniforms.controls.w * dome;
        let red = sample_premultiplied(center + displaced * (1.0 + separation));
        let blue = sample_premultiplied(center + displaced * (1.0 - separation));
        // Shared coverage bounds all three premultiplied color channels.
        refracted = vec4f(red.r, green.g, blue.b, max(red.a, max(green.a, blue.a)));
    }
    return refracted;
}
