/** Raster-only triangle adapter. Rust owns vertices, shading and order.
 * One draw uses shared-edge rasterization, avoiding Canvas 2D clip-AA seams. */
export const MV_SURFACE_RENDERER_SOURCE = String.raw`
function drawMvSurfaces(output, commands, a, b, w, h) {
  const canvas=new OffscreenCanvas(w,h);
  const gl=canvas.getContext('webgl2',{alpha:true,antialias:false,premultipliedAlpha:true,preserveDrawingBuffer:true,depth:false,stencil:false});
  if(!gl) { canvas.width=1;canvas.height=1; throw Error('Peel requires Worker WebGL2 for seamless surface rasterization'); }
  const shaders=[], resources=[];
  try {
    const compile=(type,lines)=>{
      const shader=gl.createShader(type); shaders.push(shader); gl.shaderSource(shader,lines.join('\n')); gl.compileShader(shader);
      if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) throw Error('Peel surface shader failed: '+gl.getShaderInfoLog(shader));
      return shader;
    };
    const program=gl.createProgram(); resources.push(()=>gl.deleteProgram(program));
    gl.attachShader(program,compile(gl.VERTEX_SHADER,[
      '#version 300 es',
      'in vec2 position; in vec2 uv; in float brightness; in float opacity; in float inputIndex;',
      'out vec2 textureUv; out float shade; out float alpha; out float which;',
      'void main(){gl_Position=vec4(position,0.0,1.0);textureUv=uv;shade=brightness;alpha=opacity;which=inputIndex;}'
    ]));
    gl.attachShader(program,compile(gl.FRAGMENT_SHADER,[
      '#version 300 es',
      'precision highp float; uniform sampler2D sourceA; uniform sampler2D sourceB;',
      'in vec2 textureUv; in float shade; in float alpha; in float which; out vec4 color;',
      'void main(){vec4 c=which<0.5?texture(sourceA,textureUv):texture(sourceB,textureUv);color=vec4(c.rgb*shade,c.a)*alpha;}'
    ]));
    gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS)) throw Error('Peel surface program failed');
    gl.useProgram(program);
    const vertices=[];
    for(const op of commands) {
      if((op.kind!=='surface' && op.kind!=='image') || op.clip?.kind!=='polygons' || op.clip.points.length!==1) throw Error('Invalid Peel surface plan');
      const [xx,yx,xy,yy,tx,ty]=op.transform, points=op.clip.points[0];
      for(let i=1;i<points.length-1;i++) for(const [x,y] of [points[0],points[i],points[i+1]]) {
        vertices.push((xx*x+xy*y+tx)/w*2-1,1-(yx*x+yy*y+ty)/h*2,x/w,y/h,op.brightness??1,op.opacity,op.input==='from'?0:1);
      }
    }
    const buffer=gl.createBuffer(); resources.push(()=>gl.deleteBuffer(buffer)); gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.STATIC_DRAW);
    for(const [name,size,offset] of [['position',2,0],['uv',2,8],['brightness',1,16],['opacity',1,20],['inputIndex',1,24]]) {
      const location=gl.getAttribLocation(program,name); gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location,size,gl.FLOAT,false,28,offset);
    }
    for(const [index,image] of [a,b].entries()) {
      const texture=gl.createTexture(); resources.push(()=>gl.deleteTexture(texture)); gl.activeTexture(gl.TEXTURE0+index); gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
      gl.uniform1i(gl.getUniformLocation(program,index===0?'sourceA':'sourceB'),index);
    }
    gl.viewport(0,0,w,h); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES,0,vertices.length/7); gl.finish();
    if(gl.isContextLost() || gl.getError()!==gl.NO_ERROR) throw Error('Peel surface GPU failure');
    output.drawImage(canvas,0,0);
  } finally {
    for(const release of resources.reverse()) release(); for(const shader of shaders) gl.deleteShader(shader);
    gl.getExtension('WEBGL_lose_context')?.loseContext(); canvas.width=1;canvas.height=1;
  }
}
`;
