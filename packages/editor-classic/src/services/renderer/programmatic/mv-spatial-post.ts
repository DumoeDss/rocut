import { MV_POST_SHADERS_SOURCE } from "./mv-post-shaders";

/** One disposable WebGL2 context per contiguous spatial chain. No per-frame
 * state survives a seek; CPU color groups retain their original math/order. */
export const MV_SPATIAL_POST_SOURCE =
	MV_POST_SHADERS_SOURCE +
	String.raw`
function applyMvSpatialPost(canvas, effects) {
  const active = effects.filter(p => p.effect.amount !== 0);
  if (!active.length) return;
  const w = canvas.width, h = canvas.height;
  const surface = new OffscreenCanvas(w,h);
  const gl = surface.getContext('webgl2', {alpha:true, premultipliedAlpha:true,
    antialias:false, depth:false, stencil:false, preserveDrawingBuffer:true});
  if (!gl) { surface.width=1;surface.height=1; throw Error('MV spatial post requires WebGL2'); }
  const textures = [], framebuffers = [], programs = [], shaders = [];
  const cache = new Map();
  function texture(width, height) {
    const t = gl.createTexture(); textures.push(t); gl.bindTexture(gl.TEXTURE_2D,t);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    return t;
  }
  function target(width,height) {
    const t = texture(width,height), f = gl.createFramebuffer(); framebuffers.push(f);
    gl.bindFramebuffer(gl.FRAMEBUFFER,f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t,0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
      throw Error('MV spatial post framebuffer unavailable');
    return {t,f,width,height};
  }
  function program(name) {
    if (cache.has(name)) return cache.get(name);
    const p = gl.createProgram(); programs.push(p);
    for (const [kind,code] of [[gl.VERTEX_SHADER,mvPostShaders.vertex],[gl.FRAGMENT_SHADER,mvPostShaders[name]]]) {
      const s = gl.createShader(kind); shaders.push(s); gl.shaderSource(s,code); gl.compileShader(s);
      if (!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw Error('MV post shader: '+gl.getShaderInfoLog(s));
      gl.attachShader(p,s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p,gl.LINK_STATUS)) throw Error('MV post link: '+gl.getProgramInfoLog(p));
    cache.set(name,p); return p;
  }
  function draw(name,dst,inputs,uniforms={}) {
    const p = program(name); gl.useProgram(p);
    gl.bindFramebuffer(gl.FRAMEBUFFER,dst ? dst.f : null);
    gl.viewport(0,0,dst ? dst.width : w,dst ? dst.height : h);
    let unit = 0;
    for (const [key,t] of Object.entries(inputs)) {
      gl.activeTexture(gl.TEXTURE0+unit); gl.bindTexture(gl.TEXTURE_2D,t);
      gl.uniform1i(gl.getUniformLocation(p,key),unit++);
    }
    for (const [key,v] of Object.entries(uniforms)) {
      const loc = gl.getUniformLocation(p,key);
      if (key === 'seed') gl.uniform1ui(loc,v >>> 0);
      else if (key === 'mode') gl.uniform1i(loc,v);
      else if (Array.isArray(v)) gl.uniform2fv(loc,v);
      else gl.uniform1f(loc,v);
    }
    gl.drawArrays(gl.TRIANGLES,0,3);
    if (gl.isContextLost() || gl.getError() !== gl.NO_ERROR) throw Error('MV spatial post GPU failure');
  }
  try {
    const upload = texture(w,h), ping = target(w,h), pong = target(w,h);
    gl.bindTexture(gl.TEXTURE_2D,upload);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,gl.RGBA,gl.UNSIGNED_BYTE,canvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
    let input = upload, levels;
    for (const {effect:e,seed} of active) {
      const dst = input === ping.t ? pong : ping;
      if (e.kind === 'bloom') {
        if (!levels) levels = [2,4,8].map(scale => {
          const lw = Math.max(1,Math.ceil(w/scale)), lh = Math.max(1,Math.ceil(h/scale));
          return [target(lw,lh),target(lw,lh)];
        });
        let previous = input;
        for (let i=0; i<3; i++) {
          const [a,b] = levels[i];
          draw('downsample',a,{src:previous},{res:[a.width,a.height],threshold:e.threshold,extract:i===0 ? 1 : 0});
          draw('blur',b,{src:a.t},{direction:[e.radius/w,0]});
          draw('blur',a,{src:b.t},{direction:[0,e.radius/h]});
          previous = a.t;
        }
        draw('bloom',dst,{src:input,b1:levels[0][0].t,b2:levels[1][0].t,b3:levels[2][0].t},
          {amount:e.amount,expand:e.alpha==='expand' ? 1 : 0});
      } else {
        const mode = {lineBoil:0,glitch:1,chromaticAberration:2,zoomBlur:3}[e.kind];
        if (mode === undefined) throw Error('Unsupported MV spatial effect');
        draw('spatial',dst,{src:input},{mode,seed,res:[w,h],amount:e.amount,
          cellSize:e.cellSize || 1,bands:e.bands || 1,center:e.center ? [e.center[0],1-e.center[1]] : [0.5,0.5]});
      }
      input = dst.t;
    }
    // A zero-amount zoom pass is an exact copy, including premultiplied alpha.
    draw('spatial',null,{src:input},{mode:3,amount:0,center:[0.5,0.5],res:[w,h]});
    const ctx = canvas.getContext('2d'); ctx.clearRect(0,0,w,h); ctx.drawImage(surface,0,0);
  } finally {
    for (const f of framebuffers) gl.deleteFramebuffer(f);
    for (const t of textures) gl.deleteTexture(t);
    for (const p of programs) gl.deleteProgram(p);
    for (const s of shaders) gl.deleteShader(s);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    surface.width = 1; surface.height = 1;
  }
}
`;
