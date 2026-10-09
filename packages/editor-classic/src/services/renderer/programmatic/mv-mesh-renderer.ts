/** Rust supplies convex faces, perspective divisors, shading and painter order. */
export const MV_MESH_RENDERER_SOURCE = String.raw`
function drawMvMesh(output, faces, images, w, h) {
  if (!faces.length) return;
  const canvas = new OffscreenCanvas(w, h);
  const gl = canvas.getContext('webgl2', {alpha:true,antialias:false,premultipliedAlpha:true,preserveDrawingBuffer:true,depth:false,stencil:false});
  if (!gl) { canvas.width=1;canvas.height=1; throw Error('MV textured mesh requires Worker WebGL2'); }
  const resources=[], shaders=[];
  try {
    const compile=(type,source)=>{
      const shader=gl.createShader(type); shaders.push(shader);
      gl.shaderSource(shader,source.join('\n')); gl.compileShader(shader);
      if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) throw Error('MV mesh shader failed: '+gl.getShaderInfoLog(shader));
      return shader;
    };
    const program=gl.createProgram(); resources.push(()=>gl.deleteProgram(program));
    gl.attachShader(program,compile(gl.VERTEX_SHADER,[
      '#version 300 es',
      'in vec2 position; in vec2 origin; in vec3 uPlane; in vec3 vPlane; in vec3 wPlane; in vec3 appearance; in float divisor; in vec2 refraction;',
      'flat out highp vec2 anchor; flat out highp vec3 mapU; flat out highp vec3 mapV; flat out highp vec3 mapW; flat out highp vec3 style; flat out highp vec2 colorOffset;',
      'void main(){gl_Position=vec4(position*divisor,0.0,divisor);anchor=origin;mapU=uPlane;mapV=vPlane;mapW=wPlane;style=appearance;colorOffset=refraction;}'
    ]));
    gl.attachShader(program,compile(gl.FRAGMENT_SHADER,[
      '#version 300 es',
      'precision highp float; uniform highp sampler2D sourceA; uniform highp sampler2D sourceB; uniform vec2 viewport;',
      'flat in highp vec2 anchor; flat in highp vec3 mapU; flat in highp vec3 mapV; flat in highp vec3 mapW; flat in highp vec3 style; flat in highp vec2 colorOffset; out vec4 color;',
      'bool containsUv(vec2 uv){return all(greaterThanEqual(uv,vec2(0.0)))&&all(lessThanEqual(uv,vec2(1.0)));}',
      'vec4 sourceAt(vec2 uv){return style.z<0.5?texture(sourceA,uv):texture(sourceB,uv);}',
      'void main(){vec3 p=vec3(vec2(gl_FragCoord.x,viewport.y-gl_FragCoord.y)-anchor,1.0);',
      'float denominator=dot(mapW,p);if(!(denominator>0.0)){color=vec4(0.0);return;}vec2 sampleUv=vec2(dot(mapU,p),dot(mapV,p))/denominator;',
      'if(!containsUv(sampleUv)){color=vec4(0.0);return;}vec4 c=sourceAt(sampleUv);vec2 shiftedUv=sampleUv+colorOffset;',
      'if(any(notEqual(colorOffset,vec2(0.0)))&&containsUv(shiftedUv)){vec4 shifted=sourceAt(shiftedUv);if(shifted.a>0.0)c.rgb=shifted.rgb*(c.a/shifted.a);}',
      'color=vec4(c.rgb*style.x,c.a)*style.y;}'
    ]));
    gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS)) throw Error('MV mesh shader link failed');
    gl.useProgram(program);
    const vertices=[];
    for(const face of faces) {
      for(let i=1;i<face.vertices.length-1;i++) {
        const triangle=[face.vertices[0],face.vertices[i],face.vertices[i+1]], [a,b,c]=triangle;
        const dx=b.position[0]-a.position[0],dy=b.position[1]-a.position[1];
        const ex=c.position[0]-a.position[0],ey=c.position[1]-a.position[1],area=dx*ey-dy*ex;
        if(area===0) continue;
        // Evaluate rational UV planes at pixel centers. Rasterizer subpixel snapping
        // controls coverage only, never the source texture's coordinate system.
        const plane=values=>{
          const db=values[1]-values[0],dc=values[2]-values[0];
          return [(db*ey-dc*dy)/area,(dx*dc-ex*db)/area,values[0]];
        };
        const mapU=plane(triangle.map(v=>v.uv[0]/v.w));
        const mapV=plane(triangle.map(v=>v.uv[1]/v.w));
        const mapW=plane(triangle.map(v=>1/v.w));
        if(![...mapU,...mapV,...mapW].every(value=>Number.isFinite(Math.fround(value))))
          throw Error('MV mesh texture projection is not finite');
        for(const vertex of triangle) vertices.push(
          vertex.position[0]/w*2-1,1-vertex.position[1]/h*2,...a.position,
          ...mapU,...mapV,...mapW,face.brightness,face.opacity,face.inputIndex??0,vertex.w,...(face.colorOffset??[0,0]));
      }
    }
    const buffer=gl.createBuffer(); resources.push(()=>gl.deleteBuffer(buffer));
    gl.bindBuffer(gl.ARRAY_BUFFER,buffer); gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.STATIC_DRAW);
    for(const [name,size,offset] of [['position',2,0],['origin',2,8],['uPlane',3,16],['vPlane',3,28],['wPlane',3,40],['appearance',3,52],['divisor',1,64],['refraction',2,68]]) {
      const location=gl.getAttribLocation(program,name);
      gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location,size,gl.FLOAT,false,76,offset);
    }
    for(const [index,image] of [images[0],images[1]??images[0]].entries()) {
      const texture=gl.createTexture(); resources.push(()=>gl.deleteTexture(texture));
      gl.activeTexture(gl.TEXTURE0+index); gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
      gl.uniform1i(gl.getUniformLocation(program,index===0?'sourceA':'sourceB'),index);
    }
    gl.uniform2f(gl.getUniformLocation(program,'viewport'),w,h);
    gl.viewport(0,0,w,h); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES,0,vertices.length/19); gl.finish();
    if(gl.isContextLost()||gl.getError()!==gl.NO_ERROR) throw Error('MV mesh rasterization failed');
    output.drawImage(canvas,0,0);
  } finally {
    for(const release of resources.reverse()) release();
    for(const shader of shaders) gl.deleteShader(shader);
    gl.getExtension('WEBGL_lose_context')?.loseContext(); canvas.width=1;canvas.height=1;
  }
}
function drawMvMeshImage(output, data, assets, w, h, createSurface) {
  const image=assets.image(data.image), source=createSurface ? createSurface(w,h) : new OffscreenCanvas(w,h);
  try {
    const ctx=source.getContext('2d');
    const [left,top,width,height]=data.rect;
    let x=left,y=top,iw=width,ih=height;
    if(data.fit!=='stretch') {
      const scale=(data.fit==='contain'?Math.min:Math.max)(width/image.width,height/image.height);
      iw=image.width*scale; ih=image.height*scale; x+=(width-iw)/2; y+=(height-ih)/2;
    }
    ctx.beginPath(); ctx.rect(left,top,width,height); ctx.clip();
    ctx.drawImage(image,x,y,iw,ih);
    if(data.fullImage) {
      output.save(); output.globalAlpha=data.opacity; output.drawImage(source,0,0); output.restore();
    } else drawMvMesh(output,data.faces,[source],w,h);
  } finally { source.width=1;source.height=1; }
}
function drawMvMeshTransition(output, commands, a, b, w, h) {
  const faces=commands.map(op=>{
    const inputIndex=op.input==='from'?0:1;
    if(op.kind==='mesh') return {...op,inputIndex};
    if(op.kind!=='image'||op.clip?.kind!=='polygons'||op.clip.points.length!==1||op.blend!=='source-over'||op.replace)
      throw Error('Invalid MV mesh transition plan');
    const [xx,yx,xy,yy,tx,ty]=op.transform;
    return {inputIndex,brightness:1,opacity:op.opacity,vertices:op.clip.points[0].map(([x,y])=>({
      position:[xx*x+xy*y+tx,yx*x+yy*y+ty],uv:[x/w,y/h],w:1
    }))};
  });
  drawMvMesh(output,faces,[a,b],w,h);
}
`;
