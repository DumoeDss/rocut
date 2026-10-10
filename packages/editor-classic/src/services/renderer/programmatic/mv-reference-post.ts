import { REFERENCE_POST_SHADERS, MV_REFERENCE_POST_SHADERS_SOURCE } from "./mv-reference-post-shaders";
import type {ReferencePostPlan} from "../../../../../editor-contracts/src/mv-reference-post";
export type {ReferencePostPlan} from "../../../../../editor-contracts/src/mv-reference-post";

export interface ReferencePostInputs {
 canvas: HTMLCanvasElement | OffscreenCanvas;
 scene: HTMLCanvasElement | OffscreenCanvas;
 text?: HTMLCanvasElement | OffscreenCanvas;
 foreground?: HTMLCanvasElement | OffscreenCanvas;
 lutAtlas?: HTMLCanvasElement | OffscreenCanvas;
 plan: ReferencePostPlan;
}
/** Rust owns the entire clock, parameter and pass policy. This disposable executor
 * only allocates GL resources and executes a closed, static shader vocabulary. */
export function renderReferencePost(inputs: ReferencePostInputs): void {
 executeReferencePost({inputs, referencePostShaders: REFERENCE_POST_SHADERS});
}

function executeReferencePost({inputs, referencePostShaders}: {inputs: ReferencePostInputs; referencePostShaders: typeof REFERENCE_POST_SHADERS}): void {
 const {canvas, scene, text, foreground, lutAtlas, plan} = inputs;
 if (!["tunnel-original-gl-v1","road-original-gl-v1"].includes(plan.profile) || plan.required !== true ||
     !Number.isInteger(plan.width) || !Number.isInteger(plan.height) ||
     plan.width < 8 || plan.height < 8 || plan.width > 8192 || plan.height > 8192 ||
     canvas.width !== plan.width || canvas.height !== plan.height ||
     !Number.isSafeInteger(plan.songTicks) || plan.songTicks < 0 ||
     !Number.isSafeInteger(plan.allocationBytes) || plan.allocationBytes < 1 || plan.allocationBytes > 536870912 ||
     plan.targets.length !== 7 || ![2,15].includes(plan.passes.length)) {
   throw Error("Invalid controlled reference post plan");
 }
 if (plan.lutAtlasRequired && (!lutAtlas || lutAtlas.width !== 256 || lutAtlas.height !== 16)) {
   throw Error("Reference post requires explicit 256x16 LUT atlas");
 }
 if (lutAtlas && (lutAtlas.width !== 256 || lutAtlas.height !== 16)) throw Error("Invalid reference LUT atlas");
 for(const layer of [scene,text,foreground]) {
   if(layer && (layer.width!==plan.width || layer.height!==plan.height)) throw Error("Reference layer dimensions mismatch");
   if(layer===canvas) throw Error("Reference output must not alias an input layer");
 }
 let actualBytes=plan.width*plan.height*16+256*16*4;
 for(const target of plan.targets) {
   if(!Number.isInteger(target.width) || !Number.isInteger(target.height) || target.width<1 || target.height<1 || target.width>plan.width || target.height>plan.height) throw Error("Invalid reference target dimensions");
   actualBytes+=target.width*target.height*8;
 }
 if(actualBytes!==plan.allocationBytes || actualBytes>536870912) throw Error("Reference allocation receipt mismatch");
 const context = canvas.getContext("webgl2", {preserveDrawingBuffer:true, antialias:false,
   premultipliedAlpha:false, alpha:false, depth:false, stencil:false});
 if (!context || !("createVertexArray" in context)) throw Error("Reference post requires WebGL2");
 const gl=context;
 const textures: WebGLTexture[] = [], framebuffers: WebGLFramebuffer[] = [],
   programs: WebGLProgram[] = [], shaders: WebGLShader[] = [];
 let quad: WebGLVertexArrayObject | null = null;
 let buffer: WebGLBuffer | null = null;
 const textureMap = new Map<string,WebGLTexture>();
 const targetMap = new Map<string,{framebuffer:WebGLFramebuffer;width:number;height:number}>();
 const programMap = new Map<string,WebGLProgram>();
 function texture({width, height, half}: {width:number; height:number; half:boolean}): WebGLTexture {
   const value=gl.createTexture(); if (!value) throw Error("Reference texture allocation failed");
   textures.push(value); gl.bindTexture(gl.TEXTURE_2D,value);
   gl.texImage2D(gl.TEXTURE_2D,0,half?gl.RGBA16F:gl.RGBA8,width,height,0,gl.RGBA,half?gl.HALF_FLOAT:gl.UNSIGNED_BYTE,null);
   for (const key of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D,key,gl.LINEAR);
   for (const key of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D,key,gl.CLAMP_TO_EDGE);
   return value;
 }
 function upload({name, source, premultiply, flip}: {name:string; source:TexImageSource|undefined; premultiply:boolean; flip:boolean}):void {
   const value=textureMap.get(name); if (!value) throw Error("Missing reference input texture");
   gl.bindTexture(gl.TEXTURE_2D,value);
   gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,flip);
   gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,premultiply);
   if(source) gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,gl.RGBA,gl.UNSIGNED_BYTE,source);
   else gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(4));
 }
 try {
   if (!gl.getExtension("EXT_color_buffer_float")) throw Error("Reference post requires EXT_color_buffer_float");
   if (Math.max(plan.width,plan.height)>gl.getParameter(gl.MAX_TEXTURE_SIZE)) throw Error("Reference texture exceeds device limit");
   quad=gl.createVertexArray(); buffer=gl.createBuffer();
   if(!quad || !buffer) throw Error("Reference geometry allocation failed");
   gl.bindVertexArray(quad); gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
   gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
   gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
   for (const name of ["comp","bright","blur","final"] as const) {
     const value=gl.createProgram(); if(!value) throw Error("Reference program allocation failed");
     programs.push(value);
     for (const [kind,source] of [[gl.VERTEX_SHADER,referencePostShaders.vertex],[gl.FRAGMENT_SHADER,referencePostShaders[name]]] as const) {
       const shader=gl.createShader(kind); if(!shader) throw Error("Reference shader allocation failed");
       shaders.push(shader); gl.shaderSource(shader,source); gl.compileShader(shader);
       if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) throw Error("Reference shader compile failed: "+gl.getShaderInfoLog(shader));
       gl.attachShader(value,shader);
     }
     gl.bindAttribLocation(value,0,"p"); gl.linkProgram(value);
     if(!gl.getProgramParameter(value,gl.LINK_STATUS)) throw Error("Reference shader link failed: "+gl.getProgramInfoLog(value));
     programMap.set(name,value);
   }
   for(const name of ["scene","text","fg"]) textureMap.set(name,texture({width:plan.width,height:plan.height,half:false}));
   textureMap.set("lut",texture({width:256,height:16,half:false}));
   for(const target of plan.targets) {
     if(textureMap.has(target.name) || !Number.isInteger(target.width) || !Number.isInteger(target.height) || target.width<1 || target.height<1 || target.width>plan.width || target.height>plan.height) throw Error("Invalid reference target");
     const value=texture({width:target.width,height:target.height,half:true}), framebuffer=gl.createFramebuffer();
     if(!framebuffer) throw Error("Reference framebuffer allocation failed");
     framebuffers.push(framebuffer); gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
     gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,value,0);
     if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE) throw Error("Reference RGBA16F framebuffer incomplete");
     textureMap.set(target.name,value); targetMap.set(target.name,{framebuffer,width:target.width,height:target.height});
   }
   upload({name:"scene",source:scene,premultiply:false,flip:true});
   upload({name:"text",source:text,premultiply:true,flip:true});
   upload({name:"fg",source:foreground,premultiply:true,flip:true});
   if(lutAtlas) upload({name:"lut",source:lutAtlas,premultiply:false,flip:false});
   gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
   gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.SCISSOR_TEST);
   for(const pass of plan.passes) {
     const program=programMap.get(pass.shader); if(!program) throw Error("Unknown reference shader");
     const target=pass.target===null?null:targetMap.get(pass.target);
     if(pass.target!==null && !target) throw Error("Unknown reference target");
     gl.useProgram(program); gl.bindFramebuffer(gl.FRAMEBUFFER,target?target.framebuffer:null);
     gl.viewport(0,0,target?target.width:plan.width,target?target.height:plan.height);
     let unit=0;
     for(const [name,key] of Object.entries(pass.textures)) {
       const value=textureMap.get(key); if(!value || key===pass.target || unit>=4) throw Error("Invalid reference texture binding");
       gl.activeTexture(gl.TEXTURE0+unit); gl.bindTexture(gl.TEXTURE_2D,value);
       const location=gl.getUniformLocation(program,name); if(location===null) throw Error("Unknown reference sampler");
       gl.uniform1i(location,unit++);
     }
     for(const [name,value] of Object.entries(pass.uniforms)) {
       const location=gl.getUniformLocation(program,name); if(location===null) throw Error("Unknown reference uniform");
       if(typeof value!=="number") {
         if(!Array.isArray(value) || !value.every(Number.isFinite)) throw Error("Invalid reference vector uniform");
         if(value.length===2) gl.uniform2fv(location,new Float32Array(value));
         else if(value.length===3) gl.uniform3fv(location,new Float32Array(value));
         else throw Error("Invalid reference vector size");
       } else { if(!Number.isFinite(value)) throw Error("Invalid reference scalar uniform"); gl.uniform1f(location,value); }
     }
     gl.bindVertexArray(quad); gl.drawArrays(gl.TRIANGLES,0,3);
   }
   if(gl.isContextLost() || gl.getError()!==gl.NO_ERROR) throw Error("Reference post GL execution failed");
 } finally {
   gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
   for(const value of framebuffers) gl.deleteFramebuffer(value);
   for(const value of textures) gl.deleteTexture(value);
   for(const value of programs) gl.deleteProgram(value);
   for(const value of shaders) gl.deleteShader(value);
   if(buffer) gl.deleteBuffer(buffer); if(quad) gl.deleteVertexArray(quad);
 }
}

/** A trusted static function, embedded by the native renderer without dynamic
 * imports, eval, or executing the archived engine's JavaScript. */
export const MV_REFERENCE_POST_SOURCE = MV_REFERENCE_POST_SHADERS_SOURCE +
 "\nconst executeReferencePost = " + executeReferencePost.toString() +
 ";\nfunction renderReferencePost(inputs){executeReferencePost({inputs,referencePostShaders});}";
