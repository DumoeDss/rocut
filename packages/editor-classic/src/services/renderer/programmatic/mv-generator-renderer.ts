/** Raster adapters. Geometry/animation is authoritative Rust plan data,
 * and all fonts/images come from the existing declared-resource barrier. */
export const MV_GENERATOR_RENDERER_SOURCE = String.raw`
function drawMvGlyphRain(ctx, data, assets) {
  const font = assets.descriptor(data.font);
  if (font.kind !== 'font' || !font.font) throw Error('Glyph Rain requires a declared font');
  const family = JSON.stringify(font.font.family);
  ctx.font = font.font.style + ' ' + font.font.weight + ' ' + data.fontSize + 'px ' + family;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const css = c => 'rgba(' + c.slice(0,3).map(v => v*255).join(',') + ',' + c[3] + ')';
  for (const glyph of data.glyphs) {
    ctx.globalAlpha = glyph.opacity; ctx.fillStyle = css(glyph.head ? data.headColor : data.color);
    ctx.fillText(glyph.text, glyph.x, glyph.y, data.cellWidth * 0.95);
  }
  ctx.globalAlpha = 1;
}
function drawMvParticleReveal(ctx, data, assets) {
  const image = assets.image(data.image);
  let [x,y,w,h] = data.rect, sx=0, sy=0, sw=image.width, sh=image.height;
  if (data.fit === 'contain') {
    const scale = Math.min(w/sw, h/sh), iw=sw*scale, ih=sh*scale;
    x += (w-iw)/2; y += (h-ih)/2; w=iw; h=ih;
  } else if (data.fit === 'cover') {
    const scale = Math.max(w/sw, h/sh), iw=w/scale, ih=h/scale;
    sx=(sw-iw)/2; sy=(sh-ih)/2; sw=iw; sh=ih;
  }
  if (data.fullImage) {
    ctx.globalAlpha=data.opacity; ctx.drawImage(image,sx,sy,sw,sh,x,y,w,h); ctx.globalAlpha=1;
    return;
  }
  for (const particle of data.particles) {
    const [u,v,du,dv]=particle.uv;
    ctx.save(); ctx.globalAlpha=particle.opacity;
    ctx.translate(x+(u+du/2)*w+particle.offset[0],y+(v+dv/2)*h+particle.offset[1]);
    ctx.rotate(particle.rotation); ctx.scale(particle.scale,particle.scale);
    ctx.drawImage(image,sx+u*sw,sy+v*sh,du*sw,dv*sh,-du*w/2,-dv*h/2,du*w,dv*h);
    ctx.restore();
  }
}
`;
