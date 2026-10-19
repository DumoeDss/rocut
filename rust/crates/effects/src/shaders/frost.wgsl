struct VertexOutput { @builtin(position) position: vec4f, @location(0) tex_coord: vec2f }
// Rust admission packs four 16-byte headers and two arrays of sixteen vec4s.
struct FrostUniforms {
    geometry: vec4f, // width, height, short side, amount
    optics: vec4f, // coverage, crystal scale, scatter pixels, refraction pixels
    tint: vec4f,
    metadata: vec4u, // exact seed, active capsule count, padding
    endpoints: array<vec4f,16>,
    states: array<vec4f,16>, // radius in short-side units, recovered strength
}
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var source_sampler: sampler;
@group(1) @binding(0) var<uniform> uniforms: FrostUniforms;

fn frost_hash(cell:vec2i,salt:u32)->u32 {
    var value=(bitcast<u32>(cell.x)*0x8da6b343u) ^ (bitcast<u32>(cell.y)*0xd8163841u) ^ (uniforms.metadata.x*0xcb1ab31fu) ^ (salt*0x9e3779b9u);
    value=value ^ (value>>16u);value=value*0x7feb352du;
    value=value ^ (value>>15u);value=value*0x846ca68bu;
    return value ^ (value>>16u);
}
fn frost_random(cell:vec2i,salt:u32)->f32 {return f32(frost_hash(cell,salt)&65535u)/65535.0;}

// Spatial seeded six-arm crystal needles. No frame/no wall clock enters the
// crystal pattern: complete recovery returns precisely the original ice field.
fn frost_crystal(point:vec2f)->f32 {
    let scaled=point*uniforms.optics.y;
    let cell=vec2i(floor(scaled));var crystal=0.0;
    for(var y=-1;y<=1;y+=1) {for(var x=-1;x<=1;x+=1) {
        let feature_cell=cell+vec2i(x,y);
        let feature=vec2f(feature_cell)+0.15+0.7*vec2f(frost_random(feature_cell,1u),frost_random(feature_cell,2u));
        let delta=scaled-feature;
        let angle=frost_random(feature_cell,3u)*6.28318530718;
        for(var axis=0;axis<3;axis+=1) {
            let theta=angle+f32(axis)*1.0471975512;
            let direction=vec2f(cos(theta),sin(theta));
            let along=dot(delta,direction);let across=dot(delta,vec2f(-direction.y,direction.x));
            let needle=max(0.0,1.0-abs(along)/0.7)/(1.0+784.0*across*across);
            crystal=max(crystal,needle);
        }
    }}
    return crystal;
}
fn frost_melt(point:vec2f)->f32 {
    var melt=0.0;
    for(var index=0u;index<uniforms.metadata.y;index+=1u) {
        let ends=uniforms.endpoints[index];let state=uniforms.states[index];
        let delta=ends.zw-ends.xy;let length_squared=dot(delta,delta);var progress=0.0;
        if length_squared>0.0 {progress=clamp(dot(point-ends.xy,delta)/length_squared,0.0,1.0);}
        let distance=length(point-ends.xy-progress*delta);
        let weight=1.0-smoothstep(0.6*state.x,state.x,distance);
        // Max, never sum: duplicated weak strokes cannot become a strong one.
        melt=max(melt,weight*state.y);
    }
    return melt;
}
fn frost_tap(pixel:vec2i)->vec4f {
    if any(pixel<vec2i(0)) || any(pixel>=vec2i(textureDimensions(source))) {return vec4f(0.0);}
    let value=textureLoad(source,pixel,0);
    return vec4f(value.rgb*value.a,value.a);
}
fn frost_sample(position:vec2f)->vec4f {
    let location=position-0.5;let pixel=vec2i(floor(location));let part=fract(location);
    return mix(mix(frost_tap(pixel),frost_tap(pixel+vec2i(1,0)),part.x),
        mix(frost_tap(pixel+vec2i(0,1)),frost_tap(pixel+vec2i(1,1)),part.x),part.y);
}
@fragment
fn fragment_main(in:VertexOutput)->@location(0) vec4f {
    let original=textureLoad(source,vec2i(in.position.xy),0);
    if uniforms.geometry.w==0.0 || uniforms.optics.x==0.0 ||
        (uniforms.optics.z==0.0 && uniforms.optics.w==0.0 && uniforms.tint.w==0.0) {return original;}
    if original.a==0.0 {return vec4f(0.0);}
    let point=in.position.xy/uniforms.geometry.z;
    let melt=frost_melt(point);
    if melt>=1.0 {return original;}
    let frost=uniforms.geometry.w*uniforms.optics.x*(0.25+0.75*frost_crystal(point))*(1.0-melt);
    if frost==0.0 {return original;}
    let cell=vec2i(floor(point*uniforms.optics.y));
    let offset=(2.0*vec2f(frost_random(cell,7u),frost_random(cell,8u))-1.0)*uniforms.optics.w*frost;
    let center=in.position.xy+offset;
    var scattered=vec4f(original.rgb*original.a,original.a);
    if uniforms.optics.z>0.0 {
        scattered=vec4f(0.0);
        for(var y=-1;y<=1;y+=1) {for(var x=-1;x<=1;x+=1) {
            let weight=select(1.0,2.0,x==0)*select(1.0,2.0,y==0)/16.0;
            scattered+=weight*frost_sample(center+vec2f(f32(x),f32(y))*uniforms.optics.z*frost);
        }}
    } else if uniforms.optics.w>0.0 {scattered=frost_sample(center);}
    var color=vec3f(0.0);
    if scattered.a>0.00000001 {color=scattered.rgb/scattered.a;}
    color=mix(color,uniforms.tint.rgb,uniforms.tint.w*frost);
    // Ice is a material on existing pixels, not new opaque paint. The source
    // alpha is preserved; all interpolation above was premultiplied and OOB=0.
    return vec4f(color,original.a);
}
