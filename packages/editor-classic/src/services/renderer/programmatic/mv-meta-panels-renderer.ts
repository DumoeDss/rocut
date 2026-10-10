/** Fixed native raster transport. Rust owns panel ordering, clocks and all geometry. */
export const MV_META_PANELS_RENDERER_SOURCE = String.raw`
function mvMetaPanels(ctx,data,child,make,check) {
 const owned=[];
 function surface(w,h){const c=make(w,h);owned.push(c);const x=c.getContext('2d');if(!x)throw Error('Panels native Canvas2D unavailable');return[c,x];}
 function color(c){return 'rgba('+c[0]*255+','+c[1]*255+','+c[2]*255+','+c[3]+')';}
 function poly(x,p){x.beginPath();if(p.length){x.moveTo(p[0][0],p[0][1]);for(let i=1;i<p.length;i++)x.lineTo(p[i][0],p[i][1]);x.closePath();}}
 function border(x,b){if(!b)return;x.save();try{poly(x,b.poly);x.strokeStyle=color(b.color);x.lineWidth=b.width;x.lineJoin='miter';x.setLineDash(b.dash||[]);x.lineDashOffset=0;x.stroke();}finally{x.restore();}}
 function fill(c,a){ctx.save();try{ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle=c;ctx.globalAlpha=a;ctx.fillRect(0,0,1920,1080);}finally{ctx.restore();}}
 try {
  check();let paper=null;
  if(data.paper){const p=data.paper;const[c,x]=surface(960,540);paper=c;const im=x.createImageData(960,540),raw=atob(p.rgba);if(raw.length!==im.data.length)throw Error('Panels paper byte count mismatch');for(let i=0;i<raw.length;i++)im.data[i]=raw.charCodeAt(i);x.putImageData(im,0,0);x.globalCompositeOperation='multiply';
   for(const b of p.blotches){const g=x.createRadialGradient(b.center[0],b.center[1],0,b.center[0],b.center[1],b.radius);g.addColorStop(0,'rgba(200,185,170,'+b.alpha+')');g.addColorStop(1,'rgba(200,185,170,0)');x.fillStyle=g;x.fillRect(b.center[0]-b.radius,b.center[1]-b.radius,b.radius*2,b.radius*2);}
   x.strokeStyle='rgba(110,90,80,0.16)';x.lineWidth=.7;for(const f of p.fibers){x.beginPath();x.moveTo(...f[0]);x.quadraticCurveTo(...f[1],...f[2]);x.stroke();}
  }
  fill(color(data.background),1);ctx.save();try{ctx.translate(...data.pageShift);
   for(let i=0;i<data.panels.length;i++){check();const p=data.panels[i];border(ctx,p.pen);if(p.clip.length<3)continue;
    let image=null,foreground=null,tone=null;
    if(p.child){image=child(i,'background');foreground=child(i,'foreground');if(!image||!foreground||image.width!==1920||image.height!==1080||foreground.width!==1920||foreground.height!==1080)throw Error('Panels requires full native mapped child role phases');}
    else if(p.tone){const[c,x]=surface(1920,1080);tone=c;image=c;const t=p.tone,g=x.createLinearGradient(384,0,1536,1080);g.addColorStop(0,color(t.c0));g.addColorStop(1,color(t.c1));x.fillStyle=g;x.fillRect(0,0,1920,1080);
     if(t.sun){const[sx,sy,sr]=t.sun;x.fillStyle=color(t.sunColor);x.beginPath();x.arc(sx,sy,sr,0,Math.PI*2);x.fill();x.strokeStyle=color([t.sunColor[0],t.sunColor[1],t.sunColor[2],t.sunColor[3]*.5]);x.lineWidth=3;for(const k of [1.18,1.36]){x.beginPath();x.arc(sx,sy,sr*k,0,Math.PI*2);x.stroke();}}
     x.fillStyle=color(t.dotColor);x.beginPath();for(const[dX,dY,r]of t.dots){x.moveTo(dX+r,dY);x.arc(dX,dY,r,0,Math.PI*2);}x.fill();
     if(paper){x.globalCompositeOperation='multiply';x.globalAlpha=t.paperAlpha;x.drawImage(paper,0,0,1920,1080);}
    }
    try{ctx.save();try{ctx.translate(...p.translate);poly(ctx,p.clip);ctx.clip();ctx.save();try{ctx.transform(...p.transform);if(image)ctx.drawImage(image,0,0);for(const line of p.lines){ctx.fillStyle=color(line.color);ctx.beginPath();for(const triangle of line.triangles){ctx.moveTo(...triangle[0]);ctx.lineTo(...triangle[1]);ctx.lineTo(...triangle[2]);ctx.closePath();}ctx.fill();}if(foreground)ctx.drawImage(foreground,0,0);}finally{ctx.restore();}
     if(p.flash==='negative'){ctx.globalCompositeOperation='difference';ctx.fillStyle='#FFFFFF';ctx.fillRect(-100,-100,2120,1280);ctx.globalCompositeOperation='source-over';}
     else if(p.flash==='paper'){ctx.globalAlpha=.28;ctx.fillStyle='#F4EFE6';ctx.fillRect(-100,-100,2120,1280);ctx.globalAlpha=1;}
     if(p.leading){ctx.strokeStyle=color(p.leadingColor);ctx.lineWidth=10;ctx.beginPath();ctx.moveTo(...p.leading[0]);ctx.lineTo(...p.leading[1]);ctx.stroke();}
    }finally{ctx.restore();}ctx.save();try{ctx.translate(...p.translate);border(ctx,p.keyline);}finally{ctx.restore();}}
    finally{if(tone){tone.width=0;tone.height=0;owned.splice(owned.indexOf(tone),1);}}
   }
  }finally{ctx.restore();}
  if(data.collapseFlash>0)fill('#F4EFE6',data.collapseFlash);border(ctx,data.finalFrame);
 }finally{for(const c of owned){c.width=0;c.height=0;}}
}
`;
