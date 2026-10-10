struct VertexOutput { @builtin(position) position: vec4f, @location(0) tex_coord: vec2f }
struct FlameWrapUniforms { geometry: vec4f, controls: vec4f, motion: vec4f }
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var source_sampler: sampler;
@group(1) @binding(0) var<uniform> uniforms: FlameWrapUniforms;
@group(1) @binding(1) var boundary_mask: texture_2d<f32>;
const directions = array<vec2i,8>(vec2i(1,0),vec2i(-1,0),vec2i(0,1),vec2i(0,-1),vec2i(1,1),vec2i(-1,1),vec2i(1,-1),vec2i(-1,-1));

fn occupied(p:vec2i) -> bool {
    if any(p<vec2i(0)) || any(p>=vec2i(textureDimensions(source))) { return false; }
    return textureLoad(source,p,0).a>=0.5;
}

// Alpha topology includes holes. Fully opaque images have only canvas boundary.
@fragment fn fragment_boundary(input:VertexOutput) -> @location(0) vec4f {
    let p=vec2i(input.position.xy);
    var edge=0.0;
    if occupied(p) {
        for(var i=0u;i<8u;i+=1u) { if !occupied(p+directions[i]) { edge=1.0; } }
    }
    return vec4f(edge,0.0,0.0,1.0);
}

fn mask(p:vec2i) -> f32 {
    if any(p<vec2i(0)) || any(p>=vec2i(textureDimensions(boundary_mask))) { return 0.0; }
    return textureLoad(boundary_mask,p,0).r;
}

fn hash(p:vec2i,salt:u32) -> f32 {
    var h=u32(p.x)*0x9e3779b9u ^ u32(p.y)*0x85ebca6bu ^ u32(uniforms.motion.z) ^ salt;
    h=(h^(h>>16u))*0x7feb352du; h=(h^(h>>15u))*0x846ca68bu; h=h^(h>>16u);
    return f32(h>>8u)/16777216.0;
}

fn srgb_to_linear(color:vec3f) -> vec3f {
    return select(pow((color+0.055)/1.055,vec3f(2.4)),color/12.92,color<=vec3f(0.04045));
}
fn linear_to_srgb(color:vec3f) -> vec3f {
    return select(1.055*pow(max(color,vec3f(0.0)),vec3f(1.0/2.4))-0.055,color*12.92,color<=vec3f(0.0031308));
}
fn tap(p:vec2i) -> vec4f {
    if any(p<vec2i(0)) || any(p>=vec2i(textureDimensions(source))) { return vec4f(0.0); }
    let color=textureLoad(source,p,0);
    // Multiplication alone would allow NaN hidden RGB to poison interpolation.
    if color.a<=0.0 { return vec4f(0.0); }
    // Render targets use non-sRGB UNORM views, so transfer conversion is explicit.
    return vec4f(srgb_to_linear(color.rgb)*color.a,color.a);
}
fn sample_premultiplied(p:vec2f) -> vec4f {
    let q=p-0.5; let cell=vec2i(floor(q)); let f=fract(q);
    return mix(mix(tap(cell),tap(cell+vec2i(1,0)),f.x),mix(tap(cell+vec2i(0,1)),tap(cell+vec2i(1,1)),f.x),f.y);
}
fn over(bottom:vec4f,color:vec3f,alpha:f32) -> vec4f { return vec4f(color*alpha,alpha)+bottom*(1.0-alpha); }

@fragment fn fragment_main(input:VertexOutput) -> @location(0) vec4f {
    let p=vec2i(input.position.xy); let position=input.position.xy;
    let base=tap(p); let amount=uniforms.controls.x;
    if amount==0.0 || all(uniforms.controls.yzw==vec3f(0.0)) {
        if base.a<=0.0 { return vec4f(0.0); } return textureLoad(source,p,0);
    }
    let width=uniforms.geometry.z; let height=uniforms.geometry.w;
    let wind=uniforms.motion.y; let phase=uniforms.motion.x;
    var ring=mask(p);
    // Bounded directional distance, with diagonal distances measured in pixels.
    for(var ray=0u;ray<8u;ray+=1u) {
        for(var step=1;step<=i32(ceil(width));step+=1) {
            let d=directions[ray]; let distance=f32(step)*length(vec2f(d));
            if distance<=width { ring=max(ring,mask(p+d*step)*(1.0-distance/(width+1.0))); }
        }
    }
    var plume=0.0;
    for(var step=1;step<=i32(ceil(height));step+=1) {
        let rise=f32(step)/height;
        let origin=p+vec2i(-i32(round(wind*f32(step))),step);
        let waviness=0.65+0.35*sin(6.28318530718*(phase+hash(origin,17u)+rise));
        plume=max(plume,mask(origin)*max(1.0-rise,0.0)*waviness);
    }
    let flicker=0.65+0.35*sin(6.28318530718*(phase+hash(p/4,31u)));
    let fire=max(ring*flicker,plume);
    var sparks=0.0;
    if uniforms.controls.z>0.0 {
        let cell=vec2i(floor(position/8.0));
        for(var index=0u;index<9u;index+=1u) {
            var c=cell;
            if index>0u { c+=directions[index-1u]; }
            let age=fract(phase+hash(c,53u));
            let center=(vec2f(c)+vec2f(hash(c,71u),hash(c,97u)))*8.0;
            let anchor=vec2i(floor(center+vec2f(-wind*age*height,age*height)));
            let q=(position-center)/vec2f(1.25,2.5);
            let footprint=max(1.0-dot(q,q),0.0);
            sparks=max(sparks,mask(anchor)*footprint*footprint*4.0*age*(1.0-age));
        }
    }
    var result=base;
    if uniforms.controls.w>0.0 && fire>0.0 {
        let angle=6.28318530718*(phase+hash(p/4,113u));
        let displacement=uniforms.controls.w*fire*vec2f(sin(angle),cos(angle));
        result=mix(base,sample_premultiplied(position+displacement),amount);
    }
    result=over(result,mix(vec3f(1.0,0.08,0.005),vec3f(1.0,0.8,0.15),ring),amount*uniforms.controls.y*fire);
    result=over(result,vec3f(1.0,0.75,0.2),amount*uniforms.controls.z*sparks);
    if result.a<=0.0 { return vec4f(0.0); }
    return vec4f(linear_to_srgb(result.rgb/result.a),result.a);
}
