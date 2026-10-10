/** Rust owns cut selection, camera, quantization, geometry, strips and grades.
 * This fixed compositor adds no clock or effect policy. */
export const MV_BURST_RENDERER_SOURCE = String.raw`
function* drawMvBurstSteps(ctx,data,assets,createSurface) {
  const make=(w,h)=>createSurface?createSurface(w,h):new OffscreenCanvas(w,h);
  let scene,tint;
  const css=c=>'rgba('+c.slice(0,3).map(v=>v*255).join(',')+','+c[3]+')';
  try {
    if(ctx.canvas.width!==1920||ctx.canvas.height!==1080)throw Error('Burst requires exact1920x1080');
    scene=make(1920,1080);const target=scene.getContext('2d');if(!target)throw Error('Burst Canvas2D unavailable');
    yield* drawMvEmberSteps(target,data.before,assets,createSurface);
    const ch=data.character;
    if(ch){const img=assets.image(ch.image);
      const draw=(image,offset,opacity)=>{target.save();try{
        target.globalAlpha=opacity;target.globalCompositeOperation='source-over';
        target.imageSmoothingEnabled=true;target.imageSmoothingQuality='high';
        target.translate(...offset);target.transform(...ch.transform);
        for(const strip of ch.strips)target.drawImage(image,...strip.source,...strip.destination);
      }finally{target.restore();}};
      if(ch.rim){tint=make(img.width,img.height);const x=tint.getContext('2d');if(!x)throw Error('Burst tint Canvas2D unavailable');
        x.drawImage(img,0,0);x.globalCompositeOperation='source-in';x.fillStyle=css(ch.rim);x.fillRect(0,0,img.width,img.height);
        draw(tint,ch.rimOffset,ch.rimOpacity);tint.width=tint.height=1;tint=undefined;
      }
      draw(img,[0,0],ch.opacity);yield;
    }
    yield* drawMvEmberSteps(target,data.after,assets,createSurface);
    for(const p of data.placements){ctx.save();try{
      ctx.globalAlpha=p.opacity;ctx.transform(...p.transform);ctx.drawImage(scene,-960,-540);
    }finally{ctx.restore();}yield;}
    yield* drawMvEmberSteps(ctx,data.overlay,assets,createSurface);
  }finally{if(tint)tint.width=tint.height=1;if(scene)scene.width=scene.height=1;}
}
`;
