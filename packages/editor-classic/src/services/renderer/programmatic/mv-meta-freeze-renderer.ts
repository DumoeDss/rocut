/** Fixed native HTML realm transport: Rust owns the child clock and all style geometry. */
export const MV_META_FREEZE_RENDERER_SOURCE = String.raw`
function mvMetaFreeze(ctx, input, data, make, check) {
  check();if(input.width!==1920||input.height!==1080)throw Error('Freeze requires full native child');
  if(data.live){ctx.drawImage(input,0,0);return;}
  const grey=make(1920,1080),gx=grey.getContext('2d');
  if(!gx)throw Error('Freeze native Canvas2D unavailable');
  try {
    gx.filter='grayscale(1) contrast(1.12) brightness(0.96)';gx.drawImage(input,0,0);gx.filter='none';
    for(const frame of data.frames){check();ctx.save();try{
      if(frame.clip){ctx.beginPath();frame.clip.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();ctx.clip();}
      ctx.transform(...frame.transform);ctx.drawImage(input,-960,-540);
      if(data.greyMix>0){ctx.globalAlpha=data.greyMix;ctx.drawImage(grey,-960,-540);}
    }finally{ctx.restore();}}
    function fill(color,alpha,comp){ctx.save();try{ctx.globalCompositeOperation=comp;ctx.globalAlpha=alpha;ctx.fillStyle=color;ctx.fillRect(0,0,1920,1080);}finally{ctx.restore();}}
    if(data.coldAlpha>0)fill('#9AA6C4',data.coldAlpha,'multiply');fill('#000',data.flickerAlpha,'source-over');
    for(const stroke of data.strokes){check();ctx.save();try{
      ctx.lineCap='round';ctx.lineJoin='miter';ctx.globalCompositeOperation=stroke.composite;ctx.filter=stroke.blur?'blur('+stroke.blur+'px)':'none';ctx.strokeStyle=stroke.color;ctx.lineWidth=stroke.width;
      // Original halves/branches stroke separately; ring segments share one path.
      if(stroke.joined)ctx.beginPath();
      for(const path of stroke.paths){if(!stroke.joined)ctx.beginPath();path.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));if(!stroke.joined)ctx.stroke();}
      if(stroke.joined)ctx.stroke();
    }finally{ctx.restore();}}
    for(const glow of data.glows){check();const [x,y]=glow.center,r=glow.radius;const n=parseInt(glow.color.slice(1),16),rgb=[n>>16&255,n>>8&255,n&255];const g=ctx.createRadialGradient(x,y,0,x,y,r);
      g.addColorStop(0,'rgba('+rgb+','+glow.alpha+')');g.addColorStop(.25,'rgba('+rgb+','+(glow.alpha*.45)+')');g.addColorStop(1,'rgba('+rgb+',0)');
      ctx.save();try{ctx.globalCompositeOperation='lighter';ctx.fillStyle=g;ctx.fillRect(x-r,y-r,2*r,2*r);}finally{ctx.restore();}
    }
  }finally{grey.width=grey.height=1;}
}
`;
