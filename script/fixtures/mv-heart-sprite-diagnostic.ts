/** Diagnostic-only primitive isolation. Never supplies production/oracle output. */
import { HEART_SPRITE_READBACK_CONTROL_SOURCE } from "./mv-heart-sprite-diagnostic-readback";
export const HEART_SPRITE_DIAGNOSTIC_SOURCE = HEART_SPRITE_READBACK_CONTROL_SOURCE + String.raw`
function heartSpriteDiagnostics(plan, preparedImage) {
  const hb = heartBuild('heart');
  const make = (w,h) => {const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
  const pixels = c => c.getContext('2d').getImageData(0,0,c.width,c.height).data.slice();
  const diff = (a,b) => {
    if(a.length!==b.length)return {sizeMismatch:[a.length,b.length]};
    let max=0,total=0,changed=0;for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);max=Math.max(max,d);total+=d;if(d)changed++;}
    return {max,mae:total/a.length,changed};
  };
  const body=plan.commands.find(c=>c.kind==='surface'&&c.id==='heart-body');
  if(!body)throw Error('Diagnostic requires actual native body surface');
  const pieces=plan.commands.filter(c=>c.kind==='surface'&&c.id.startsWith('heart-piece'));
  const firstChar=pieces.find(c=>c.commands.some(p=>p.kind==='rect'&&p.paint.composite==='multiply'));
  const controlledCharReadback=heartControlledCharReadback({body,command:firstChar,preparedImage,
    original:hb.shards[0]?.spr.char,originalBody:hb.body,pixels,diff,make});
  const counters={char:0,base:0,glow:0,flame:0};
  const makePath=steps=>{const path=new Path2D();for(const step of steps){if(step.kind==='moveTo')path.moveTo(...step.point);else if(step.kind==='lineTo')path.lineTo(...step.point);else if(step.kind==='close')path.closePath();else throw Error('Unexpected diagnostic shard path');}return path;};
  const rows=[];
  let bodyDifference;
  for(const command of pieces){
    const shadow=command.commands.find(p=>p.kind==='shadowPath');
    const variant=shadow?(shadow.shadow.blurPx===16?'flame':'glow'):command.commands.some(p=>p.kind==='rect'&&p.paint.composite==='multiply')?'char':'base';
    const ordinal=counters[variant]++;
    // Current failure boundary is shatter: 3 smears + main glow per shard.
    const shard=variant==='glow'?Math.floor(ordinal/4):ordinal;
    if(variant==='glow'&&ordinal%4!==0)continue;
    const spr=hb.shards[shard]?.spr;
    if(!spr)throw Error('Diagnostic native/original shard count mismatch');
    let latest;
    const allocated=[];
    const sink=make(1,1);
    for(const _ of drawMvEmberSteps(sink.getContext('2d'),{commands:[body,command]}, {preparedImage}, (w,h)=>{
      const c=make(w,h);allocated.push(c);return c;
    })){
      if(allocated.length===1&&!bodyDifference)bodyDifference=diff(pixels(allocated[0]),pixels(hb.body));
      if(allocated.length===2)latest=pixels(allocated[1]);
    }
    const original=spr[variant];
    if(!original)throw Error('Original diagnostic sprite variant absent');
    const expected=pixels(original);
    const variants={};
    for(const path2d of [false,true])for(const threeArgs of [false,true]){
      const c=make(...command.size),ctx=c.getContext('2d');
      for(const p of command.commands){
        ctx.save();
        if(p.clip){mvEmberTransform(ctx,p.clip);if(path2d)ctx.clip(makePath(p.clip.path));else {mvEmberPath(ctx,p.clip.path);ctx.clip('nonzero');}}
        mvEmberTransform(ctx,p);
        if(p.kind==='shadowPath'||p.kind==='path'){
          let path;
          if(path2d)path=makePath(p.path);
          else mvEmberPath(ctx,p.path);
          if(p.kind==='shadowPath'){ctx.shadowColor=mvEmberCss(p.shadow.color);ctx.shadowBlur=p.shadow.blurPx;ctx.shadowOffsetX=ctx.shadowOffsetY=0;}
          for(const paint of p.paints){
            if(path2d){ctx.globalCompositeOperation=paint.composite;ctx.globalAlpha=paint.opacity;ctx.strokeStyle=mvEmberStyle(ctx,paint.style);ctx.lineWidth=paint.width;ctx.lineCap=paint.cap;ctx.lineJoin=paint.join;ctx.stroke(path);}
            else mvEmberPaint(ctx,paint);
          }
        }else if(p.kind==='blit'){
          ctx.globalCompositeOperation=p.composite;ctx.globalAlpha=p.opacity;
          if(threeArgs)ctx.drawImage(hb.body,...p.destinationRect.slice(0,2));
          else ctx.drawImage(hb.body,...p.sourceRect,...p.destinationRect);
        }else if(p.kind==='rect')mvEmberPaint(ctx,p.paint,p.rect);
        else throw Error('Unexpected diagnostic sprite primitive');
        ctx.restore();
      }
      variants[(path2d?'path2d':'current')+'/'+(threeArgs?'draw3':'draw9')]=diff(pixels(c),expected);
      c.width=c.height=1;
    }
    const transformed={};
    // Identical CTM/alpha/composite for original and actual native identity bytes.
    const native=make(...command.size);native.getContext('2d').putImageData(new ImageData(latest,...command.size),0,0);
    for(const threeArgs of [false,true]){
      const render=image=>{const c=make(600,600),ctx=c.getContext('2d');ctx.translate(300.25,300.75);ctx.rotate(.173);ctx.scale(.81,1.03);ctx.globalCompositeOperation='lighter';ctx.globalAlpha=.174;threeArgs?ctx.drawImage(image,-image.width/2,-image.height/2):ctx.drawImage(image,0,0,image.width,image.height,-image.width/2,-image.height/2,image.width,image.height);const out=pixels(c);c.width=c.height=1;return out;};
      transformed[threeArgs?'draw3':'draw9']=diff(render(native),render(original));
    }
    native.width=native.height=sink.width=sink.height=1;
    rows.push({shard,variant,readbackMode:'per-yield-with-body-read',size:command.size,originalSize:[original.width,original.height],actualIdentity:diff(latest,expected),variants,transformed});
  }
  return {scope:'diagnostic-only shatter sprite identities and identical fixed transform; isolated original realm, no acceptance substitution',controlledCharReadback,pieceSurfaceCount:pieces.length,variantCounts:counters,bodyDifference,originalShardCount:hb.shards.length,rows};
}
`;
