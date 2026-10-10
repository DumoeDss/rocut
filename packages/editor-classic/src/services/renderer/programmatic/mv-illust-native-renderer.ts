/** Fixed primitive replay only; all source rectangles, transforms, paths,
 * colors, blur radii and role decisions arrive in the sampled Rust plan. */
export const MV_ILLUST_NATIVE_RENDERER_SOURCE = String.raw`
function* drawMvIllustNativeSteps(ctx,data,assets,createSurface,role) {
  const make=(w,h)=>createSurface?createSurface(w,h):new OffscreenCanvas(w,h);
  const css=c=>'rgba('+c.slice(0,3).map(v=>v*255).join(',')+','+c[3]+')';
  if(ctx.canvas.width!==1920||ctx.canvas.height!==1080)throw Error('IllustNative requires exact1920x1080');
  for(const c of data.commands){
    if(c.role!==role)continue;
    if(c.kind==='native'){yield* drawMvEmberSteps(ctx,{commands:[c.command]},assets,createSurface);continue;}
    let tint;
    ctx.save();try{
      if(c.kind==='sprite'){
        const s=c.sprite;let img=assets.image(s.image);
        if(c.tint){tint=make(img.width,img.height);const x=tint.getContext('2d');if(!x)throw Error('IllustNative tint Canvas2D unavailable');
          x.drawImage(img,0,0);x.globalCompositeOperation='source-in';x.fillStyle=css(c.tint);x.fillRect(0,0,img.width,img.height);img=tint;}
        ctx.globalAlpha=s.opacity;ctx.globalCompositeOperation=c.composite;ctx.filter=c.blurPx?'blur('+c.blurPx+'px)':'none';
        ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.translate(...c.offset);ctx.transform(...s.transform);
        for(const p of s.strips)ctx.drawImage(img,...p.source,...p.destination);
      }else if(c.kind==='path'){
        ctx.globalCompositeOperation=c.composite;ctx.filter=c.blurPx?'blur('+c.blurPx+'px)':'none';ctx.strokeStyle=css(c.color);
        ctx.lineCap='round';ctx.lineJoin='round';ctx.lineWidth=c.width;mvEmberPath(ctx,c.path);ctx.stroke();
      }else if(c.kind==='feather'){
        ctx.transform(...c.transform);ctx.fillStyle=css(c.color);ctx.strokeStyle=css(c.line);ctx.lineWidth=2.2;
        const path=steps=>{ctx.beginPath();for(const p of steps){if(p.kind==='move')ctx.moveTo(...p.point);
          else if(p.kind==='cubic')ctx.bezierCurveTo(...p.points);else if(p.kind==='quadratic')ctx.quadraticCurveTo(...p.points);
          else throw Error('Unknown IllustNative feather path');}};
        path(c.body);ctx.fill();ctx.stroke();path(c.spine);ctx.stroke();
      }else throw Error('Unknown IllustNative command');
    }finally{ctx.restore();if(tint)tint.width=tint.height=1;}
    yield;
  }
}
`;
