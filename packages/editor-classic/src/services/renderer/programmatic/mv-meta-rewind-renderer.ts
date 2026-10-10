/** Fixed draw-only tape replay. Native physical font resolver supplied by realm. */
export const MV_META_REWIND_RENDERER_SOURCE = String.raw`
function mvMetaRewind(ctx,input,data,make,font,check) {
 check();if(input&&(input.width!==1920||input.height!==1080))throw Error('Rewind requires full native child');
 const owned=[];function surface(w,h){const c=make(w,h);owned.push(c);const x=c.getContext('2d');if(!x)throw Error('Rewind native Canvas2D unavailable');return[c,x];}
 try {
  const [src,sx]=surface(1920,1080);if(input)sx.drawImage(input,0,0);else{sx.fillStyle='#000';sx.fillRect(0,0,1920,1080);}
  const [soft,so]=surface(960,1080);so.drawImage(src,0,0,960,1080);
  const [out,ox]=surface(1920,1080);ox.drawImage(soft,0,0,1920,1080);
  const [ch,cc]=surface(200,112);cc.drawImage(src,0,0,200,112);
  ox.globalCompositeOperation='color';ox.globalAlpha=.9;ox.drawImage(ch,12,2,1920,1080);
  ox.globalCompositeOperation='screen';ox.globalAlpha=.22;ox.drawImage(ch,26,0,1920,1080);
  function fill(x,color,alpha,comp){x.save();try{x.setTransform(1,0,0,1,0,0);x.globalCompositeOperation=comp;x.globalAlpha=alpha;x.fillStyle=color;x.fillRect(0,0,1920,1080);}finally{x.restore();}}
  ox.globalAlpha=1;ox.globalCompositeOperation='source-over';fill(ox,'#1B1733',.42,'screen');fill(ox,'#D8D2E6',.12,'multiply');
  const [scan,sc]=surface(1920,1080);sc.fillStyle='#fff';sc.fillRect(0,0,1920,1080);sc.fillStyle='rgba(30,26,40,.55)';for(const rect of data.scanlines)sc.fillRect(...rect);
  ox.globalCompositeOperation='multiply';ox.globalAlpha=.5;ox.drawImage(scan,0,0);ox.globalAlpha=1;ox.globalCompositeOperation='source-over';
  for(const strip of data.strips){check();ctx.drawImage(out,...strip.source,...strip.destination);}
  if(data.slip){ctx.fillStyle='#000';ctx.fillRect(0,1080-data.slip,1920,data.slip);ctx.fillStyle='rgba(240,240,255,.8)';ctx.fillRect(0,1080-data.slip+5,1920,3);}
  const [st,stx]=surface(640,256);const id=stx.createImageData(640,256);if(data.staticRgba.length!==id.data.length)throw Error('Rewind static raster size mismatch');id.data.set(data.staticRgba);stx.putImageData(id,0,0);
  ctx.save();try{ctx.globalCompositeOperation='lighter';for(const b of data.snow.slice(0,-1)){check();ctx.globalAlpha=b.alpha;ctx.drawImage(st,...b.source,...b.destination);}
   ctx.globalAlpha=.85;ctx.fillStyle='#F0F0FF';for(const rect of data.dropouts)ctx.fillRect(...rect);
   const b=data.snow[data.snow.length-1];if(b){ctx.globalAlpha=b.alpha;ctx.drawImage(st,...b.source,...b.destination);}
  }finally{ctx.restore();}
  if(data.osd){ctx.save();try{ctx.shadowColor='rgba(0,0,0,.6)';ctx.shadowOffsetX=4;ctx.shadowOffsetY=4;ctx.shadowBlur=0;ctx.fillStyle='#F2F2F6';ctx.textBaseline='middle';
   for(const text of data.osd.texts){check();ctx.font=font(data.osd.fontId,text.size);ctx.textAlign=text.align;ctx.fillText(text.text,...text.position);if(text.text==='REW')for(const p of data.osd.arrows){ctx.beginPath();p.forEach((v,i)=>i?ctx.lineTo(...v):ctx.moveTo(...v));ctx.closePath();ctx.fill();}}
  }finally{ctx.restore();}}
 }finally{for(const c of owned)c.width=c.height=1;}
}
`;
