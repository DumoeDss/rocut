/** Fixed native drawing; Rust owns liquid front, gravity, sampled child and droplets. */
export const MV_META_MELT_RENDERER_SOURCE = String.raw`
function mvMetaMelt(ctx,input,data,make,check) {
 check();if(input.width!==1920||input.height!==1080)throw Error('Melt requires full native child');
 const owned=[];function surface(w,h){const c=make(w,h);owned.push(c);const x=c.getContext('2d');if(!x)throw Error('Melt native Canvas2D unavailable');return[c,x];}
 function fill(x,color,alpha,comp){x.save();try{x.setTransform(1,0,0,1,0,0);x.globalCompositeOperation=comp;x.globalAlpha=alpha;x.fillStyle=color;x.fillRect(0,0,1920,1080);}finally{x.restore();}}
 function vgrad(x,stops,alpha){const g=x.createLinearGradient(0,0,0,1080);for(const [at,color]of stops)g.addColorStop(at,color);x.save();try{x.globalAlpha=alpha;x.fillStyle=g;x.fillRect(0,0,1920,1080);}finally{x.restore();}}
 try {
  const[cold,cx]=surface(1920,1080);cx.drawImage(input,0,0);fill(cx,'#3A62B8',.88,'color');fill(cx,'#86A4E6',.45,'multiply');fill(cx,'#071433',.35,'screen');
  const[hi,hx]=surface(1920,1080);hx.filter='contrast(2.6) brightness(0.62) saturate(1.2)';hx.drawImage(input,0,0);hx.filter='none';fill(hx,'#5C86E0',.55,'color');fill(hx,'#000',.08,'source-over');
  const[small,sm]=surface(1920,60);sm.drawImage(hi,0,0,1920,60);
  const[hiV,hv]=surface(1920,1080);hv.drawImage(small,0,0,1920,1080);
  vgrad(ctx,[[0,'#010309'],[.55,'#040B1A'],[1,'#081830']],1);
  ctx.save();try{for(const c of data.columns){check();ctx.globalCompositeOperation='source-over';ctx.globalAlpha=1;ctx.drawImage(input,c.x,0,c.width,1080,c.x,c.y,c.width,1080);
   if(c.cool>.01){ctx.globalAlpha=c.cool;ctx.drawImage(cold,c.x,0,c.width,1080,c.x,c.y,c.width,1080);}
   ctx.globalCompositeOperation='lighten';for(const [y,alpha]of c.echoes){ctx.globalAlpha=alpha;ctx.drawImage(hiV,c.x,0,c.width,1080,c.x,y,c.width,1080);}
  }}finally{ctx.restore();}
  ctx.save();try{for(const c of data.columns)if(c.front){const[y,fall]=c.front;const g=ctx.createLinearGradient(0,y-2,0,y+fall);g.addColorStop(0,'rgba(2,5,14,1)');g.addColorStop(1,'rgba(2,5,14,0)');ctx.fillStyle=g;ctx.fillRect(c.x,y-2,c.width,fall+2);}
   ctx.globalCompositeOperation='lighter';for(const drop of data.drops){check();const[x,y,w,h]=drop.rect;const g=ctx.createLinearGradient(0,y,0,y+h);g.addColorStop(0,'rgba(120,170,255,0)');g.addColorStop(1,'rgba(200,225,255,'+drop.alpha+')');ctx.fillStyle=g;ctx.fillRect(x,y,w,h);
    const[cx,cy]=drop.center,r=drop.radius,al=.55*drop.alpha;const glow=ctx.createRadialGradient(cx,cy,0,cx,cy,r);glow.addColorStop(0,'rgba(168,200,255,'+al+')');glow.addColorStop(.25,'rgba(168,200,255,'+(al*.45)+')');glow.addColorStop(1,'rgba(168,200,255,0)');ctx.fillStyle=glow;ctx.fillRect(cx-r,cy-r,2*r,2*r);
   }
  }finally{ctx.restore();}
  if(data.topAlpha>0){vgrad(ctx,data.topStops,data.topAlpha);fill(ctx,'#2E4F9A',data.blueAlpha,'color');}
  if(data.stopAlpha>0)fill(ctx,'#000',data.stopAlpha,'source-over');
 }finally{for(const c of owned)c.width=c.height=1;}
}
`;
