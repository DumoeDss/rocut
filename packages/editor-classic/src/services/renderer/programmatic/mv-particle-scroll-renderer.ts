/** Draw Rust-resolved image fragments without a clock or local animation rules. */
export const MV_PARTICLE_SCROLL_RENDERER_SOURCE = String.raw`
function drawMvParticleScroll(ctx, data, assets) {
  const image = assets.image(data.image);
  let [x,y,w,h] = data.rect, sx=0, sy=0, sw=image.width, sh=image.height;
  if (data.fit === 'contain') {
    const scale=Math.min(w/sw,h/sh), iw=sw*scale, ih=sh*scale;
    x+=(w-iw)/2; y+=(h-ih)/2; w=iw; h=ih;
  } else if (data.fit === 'cover') {
    const scale=Math.max(w/sw,h/sh), iw=w/scale, ih=h/scale;
    sx=(sw-iw)/2; sy=(sh-ih)/2; sw=iw; sh=ih;
  }
  ctx.save();
  if (data.fullImage) {
    ctx.globalAlpha=data.opacity;
    ctx.drawImage(image,sx,sy,sw,sh,x,y,w,h);
    ctx.restore();
    return;
  }
  if (data.intactUv) {
    const [u,v,du,dv]=data.intactUv;
    ctx.globalAlpha=data.opacity;
    ctx.drawImage(image,sx+u*sw,sy+v*sh,du*sw,dv*sh,x+u*w,y+v*h,du*w,dv*h);
  }
  if (data.particleClipUv) {
    const [cu,cv,cw,ch]=data.particleClipUv;
    ctx.beginPath(); ctx.rect(x+cu*w,y+cv*h,cw*w,ch*h); ctx.clip();
    for (const particle of data.particles) {
      const [u,v,du,dv]=particle.uv;
      ctx.save(); ctx.globalAlpha=particle.opacity;
      ctx.translate(x+(u+du/2)*w+particle.offset[0],y+(v+dv/2)*h+particle.offset[1]);
      ctx.rotate(particle.rotation); ctx.scale(particle.scale,particle.scale);
      ctx.drawImage(image,sx+u*sw,sy+v*sh,du*sw,dv*sh,-du*w/2,-dv*h/2,du*w,dv*h);
      ctx.restore();
    }
  }
  ctx.restore();
}
`;
