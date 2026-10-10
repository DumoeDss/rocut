// Independent Canvas layout. Source must be non-sRGB RGBA8Unorm straight sRGB.
// Float material textures are RGBA32Float, nonfilterable; no sampler is bound.
struct VertexOutput { @builtin(position) position: vec4f, @location(0) tex_coord: vec2f }
struct CanvasUniforms {
    geometry: vec4u, // full source width,height; grid columns,rows
    material: vec4f, // weave frequency,height,relief,padding
    light: vec4f, // normalized light xyz
    metadata: vec4u, // exact seed
}
@group(0) @binding(0) var source: texture_2d<f32>;
@group(1) @binding(0) var<uniform> uniforms: CanvasUniforms;
@group(1) @binding(1) var pigment_coverage: texture_2d<f32>;
@group(1) @binding(2) var height_wetness: texture_2d<f32>;

fn decode_srgb(v: vec3f) -> vec3f {
    return select(pow((v+0.055)/1.055,vec3f(2.4)),v/12.92,v<=vec3f(0.04045));
}
fn encode_srgb(v: vec3f) -> vec3f {
    return select(1.055*pow(v,vec3f(1.0/2.4))-0.055,12.92*v,v<=vec3f(0.0031308));
}
fn grid_pixel(p: vec2i) -> vec2i {
    return clamp(p,vec2i(0),vec2i(uniforms.geometry.zw)-vec2i(1));
}
fn weave(p: vec2i) -> f32 {
    let short=f32(min(uniforms.geometry.z,uniforms.geometry.w));
    let point=(vec2f(p)+0.5)/short;
    let phase=f32(uniforms.metadata.x%997u)/997.0*6.283185307179586;
    let u=point.x*uniforms.material.x*6.283185307179586+phase;
    let v=point.y*uniforms.material.x*6.283185307179586+phase*0.7;
    return uniforms.material.y*(cos(u)*0.45+cos(v)*0.45+sin(u)*sin(v)*0.1);
}
fn height_tap(p: vec2i) -> f32 {
    let q=grid_pixel(p);
    return textureLoad(height_wetness,q,0).x+weave(q);
}
fn height_at(p: vec2f) -> f32 {
    let q=vec2i(floor(p)); let f=fract(p);
    return mix(mix(height_tap(q),height_tap(q+vec2i(1,0)),f.x),
        mix(height_tap(q+vec2i(0,1)),height_tap(q+vec2i(1,1)),f.x),f.y);
}
fn pigment_at(p: vec2f) -> vec4f {
    let q=vec2i(floor(p)); let f=fract(p);
    return mix(mix(textureLoad(pigment_coverage,grid_pixel(q),0),textureLoad(pigment_coverage,grid_pixel(q+vec2i(1,0)),0),f.x),
        mix(textureLoad(pigment_coverage,grid_pixel(q+vec2i(0,1)),0),textureLoad(pigment_coverage,grid_pixel(q+vec2i(1,1)),0),f.x),f.y);
}
fn wet_at(p: vec2f) -> f32 {
    let q=vec2i(floor(p)); let f=fract(p);
    return mix(mix(textureLoad(height_wetness,grid_pixel(q),0).y,textureLoad(height_wetness,grid_pixel(q+vec2i(1,0)),0).y,f.x),
        mix(textureLoad(height_wetness,grid_pixel(q+vec2i(0,1)),0).y,textureLoad(height_wetness,grid_pixel(q+vec2i(1,1)),0).y,f.x),f.y);
}
@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
    // Original full-resolution pixel is NEVER replaced by an upsampled grid image.
    let original=textureLoad(source,vec2i(in.position.xy),0);
    if original.a==0.0 { return vec4f(0.0); }
    let p=in.position.xy/vec2f(uniforms.geometry.xy)*vec2f(uniforms.geometry.zw)-0.5;
    let short=f32(min(uniforms.geometry.z,uniforms.geometry.w));
    let gx=(height_at(p+vec2f(1,0))-height_at(p-vec2f(1,0)))*short*0.5*uniforms.material.z;
    let gy=(height_at(p+vec2f(0,1))-height_at(p-vec2f(0,1)))*short*0.5*uniforms.material.z;
    let diffuse=max(dot(normalize(vec3f(-gx,-gy,1)),uniforms.light.xyz),0.0);
    let pigment=pigment_at(p);
    let shine=wet_at(p)*0.18*pow(diffuse,24.0);
    let premul=decode_srgb(original.rgb)*original.a;
    let color=clamp((pigment.rgb*original.a+premul*(1.0-pigment.a))*(0.65+0.35*diffuse)+vec3f(shine*original.a),vec3f(0),vec3f(original.a));
    return vec4f(encode_srgb(color/original.a),original.a);
}
