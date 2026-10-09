/** Spatial mechanisms adapted from vocaloid-style-mv-pipeline (MIT, NikusonP
 * 2026); see editor-classic/NOTICE. Unlike the opaque reference compositor,
 * every sample/pass here carries premultiplied alpha in sRGB. */
const vertex = `#version 300 es
out vec2 uv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  uv = p; gl_Position = vec4(p * 2. - 1., 0., 1.);
}`;
const common = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv; out vec4 o;
uniform sampler2D src;
uniform vec2 res;
vec4 at(vec2 q) {
  if (any(lessThan(q, vec2(0.))) || any(greaterThan(q, vec2(1.)))) return vec4(0.);
  return texture(src, q);
}
`;
const spatial =
	common +
	`
uniform int mode;
uniform uint seed;
uniform float amount, cellSize, bands;
uniform vec2 center;
float hash(ivec2 p, uint salt) {
  uint n = uint(p.x) * 374761393u ^ uint(p.y) * 668265263u ^ seed ^ salt;
  n = (n ^ (n >> 13)) * 1274126177u;
  return float((n ^ (n >> 16)) >> 8) / 16777216.;
}
float noise(vec2 p, uint salt) {
  ivec2 i = ivec2(floor(p)); vec2 f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(hash(i,salt),hash(i+ivec2(1,0),salt),f.x),
    mix(hash(i+ivec2(0,1),salt),hash(i+ivec2(1,1),salt),f.x),f.y);
}
void main() {
  vec2 pixel = vec2(uv.x, 1.-uv.y) * res;
  if (mode == 0) {
    vec2 n = vec2(noise(pixel/cellSize, 0u), noise(pixel/cellSize, 951274213u)) * 2. - 1.;
    o = at(uv + n*amount/vec2(res.x, -res.y));
  } else if (mode == 1) {
    int band = int(floor((1.-uv.y)*bands));
    float shift = hash(ivec2(band,0),0u) > 1.-amount*0.55
      ? (hash(ivec2(band,0),7162371u)-0.5)*0.18*amount : 0.;
    int fine = int(floor((1.-uv.y)*bands*3.6842105));
    if (hash(ivec2(fine,1),13531u) > 1.-amount*0.3)
      shift += (hash(ivec2(fine,1),95431u)-0.5)*0.03*amount;
    o = at(uv + vec2(shift,0.));
  } else if (mode == 2) {
    vec2 d = (uv-center)*res;
    vec2 offset = length(d) > 0.0001 ? normalize(d)*amount/res : vec2(0.);
    vec4 r = at(uv+offset), g = at(uv), b = at(uv-offset);
    o = vec4(r.r, g.g, b.b, max(r.a,max(g.a,b.a)));
  } else {
    vec4 sum = vec4(0.); float weights = 0.;
    for (int i=0; i<14; i++) {
      float k = float(i)/13., weight = 1.-k*0.6;
      sum += at(uv-(uv-center)*k*amount)*weight; weights += weight;
    }
    o = sum/weights;
  }
}`;
const downsample =
	common +
	`
uniform float threshold, extract;
vec4 sampleBright(vec2 q) {
  vec4 c = at(q);
  if (extract < 0.5 || c.a <= 0.) return c;
  float l = max(c.r,max(c.g,c.b))/c.a;
  return c * smoothstep(threshold,threshold+0.25,l);
}
void main() {
  vec2 d = 0.25/res;
  o = (sampleBright(uv+d)+sampleBright(uv-d)
    +sampleBright(uv+vec2(d.x,-d.y))+sampleBright(uv+vec2(-d.x,d.y)))*0.25;
}`;
const blur =
	common +
	`
uniform vec2 direction;
void main() {
  o = at(uv)*0.227027027;
  o += (at(uv+direction*1.3846153846)+at(uv-direction*1.3846153846))*0.3162162162;
  o += (at(uv+direction*3.2307692308)+at(uv-direction*3.2307692308))*0.0702702703;
}`;
const bloom =
	common +
	`
uniform sampler2D b1, b2, b3;
uniform float amount, expand;
void main() {
  vec4 c = at(uv);
  vec3 glow = (texture(b1,uv).rgb*0.5 + texture(b2,uv).rgb*0.8 + texture(b3,uv).rgb*1.1)*amount;
  if (expand > 0.5) {
    vec3 rgb = clamp(c.rgb+glow,0.,1.);
    o = vec4(rgb, max(c.a,max(rgb.r,max(rgb.g,rgb.b))));
  } else o = vec4(clamp(c.rgb+glow*c.a,0.,c.a),c.a);
}`;

export const MV_POST_SHADERS_SOURCE = `const mvPostShaders = ${JSON.stringify({
	vertex,
	spatial,
	downsample,
	blur,
	bloom,
})};`;
