/** Raster-only typeCard adapter. All time, layout, randomness and geometry are
 * evaluated by Rust, including the platform-measured quiet glyph positions.
 */
export const MV_TYPE_CARD_RENDERER_SOURCE = String.raw`
function drawMvTypeCard(ctx, data, assets, w, h, createSurface) {
  const surfaces = [];
  const make = (width,height) => {
    const c = createSurface ? createSurface(width,height) : new OffscreenCanvas(width,height); surfaces.push(c); return c;
  };
  const css = c => 'rgba(' + c.slice(0,3).map(v => v * 255).join(',') + ',' + c[3] + ')';
  const text = (target, spec) => {
    if (!spec) return;
    const d = assets.descriptor(spec.font);
    if (d.kind !== 'font' || !d.font) throw Error('typeCard requires a declared font');
    target.save();
    try {
      target.font = d.font.style + ' ' + d.font.weight + ' ' + spec.fontSize + 'px ' + JSON.stringify(d.font.family);
      target.letterSpacing = spec.tracking + 'px';
      target.textAlign = 'center'; target.textBaseline = 'middle';
      target.fillStyle = css(spec.color); target.globalAlpha = spec.opacity;
      target.filter = spec.blur > 0 ? 'blur(' + spec.blur + 'px)' : 'none';
      target.fillText(spec.text, ...spec.position);
    } finally { target.restore(); }
  };
  const rect = (target, spec) => {
    if (!spec) return;
    target.save();
    try {
      target.fillStyle = css(spec.color); target.globalAlpha = spec.opacity;
      target.fillRect(...spec.rect);
    } finally { target.restore(); }
  };
  const glow = spec => {
    if (!spec) return;
    ctx.save();
    try {
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 1;
      const g = ctx.createRadialGradient(...spec.center,0,...spec.center,spec.radius);
      for (const stop of spec.stops) g.addColorStop(stop.offset,css(stop.color));
      ctx.fillStyle = g; ctx.fillRect(...spec.rect);
    } finally { ctx.restore(); }
  };
  ctx.save();
  try {
    ctx.setTransform(1,0,0,1,0,0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = css(data.background); ctx.fillRect(0,0,w,h);
    if (data.quiet) {
      for (const glyph of data.quiet.glyphs) text(ctx,glyph);
      for (const line of data.quiet.rule) rect(ctx,line);
      text(ctx,data.quiet.subtitle);
    }
    if (data.flicker) {
      const flicker = data.flicker;
      if (flicker.bands.length) {
        const scratch = make(w,h), sx = scratch.getContext('2d');
        sx.save();
        try {
          sx.setTransform(...flicker.transform); sx.globalCompositeOperation = 'lighter';
          for (const run of flicker.text) text(sx,run);
        } finally { sx.restore(); }
        if (flicker.frame) {
          sx.strokeStyle = css(flicker.frame.color); sx.lineWidth = flicker.frame.width;
          sx.strokeRect(...flicker.frame.rect);
        }
        rect(sx,flicker.indicator);
        sx.save();
        try {
          sx.globalCompositeOperation = 'destination-out'; sx.fillStyle = '#000';
          for (const eraser of flicker.erasers) {
            sx.globalAlpha = eraser.opacity; sx.fillRect(...eraser.rect);
          }
        } finally { sx.restore(); }
        ctx.save();
        try {
          for (const band of flicker.bands) {
            ctx.globalAlpha = band.opacity;
            ctx.drawImage(scratch,...band.sourceRect,...band.destinationRect);
          }
          ctx.globalCompositeOperation = 'lighter';
          for (const block of flicker.blocks) rect(ctx,block);
        } finally { ctx.restore(); }
        glow(flicker.kickGlow);
      }
      rect(ctx,flicker.idleScan);
      for (const element of flicker.morse.elements) rect(ctx,element);
      text(ctx,flicker.morse.label);
    }
    if (data.grain) {
      const grain = data.grain, tile = make(...grain.size), gx = tile.getContext('2d');
      const pixels = gx.createImageData(...grain.size);
      for (let i=0; i<grain.gray.length; i++) {
        pixels.data[i*4] = pixels.data[i*4+1] = pixels.data[i*4+2] = grain.gray[i];
        pixels.data[i*4+3] = 255;
      }
      gx.putImageData(pixels,0,0);
      ctx.save();
      try {
        ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = grain.opacity;
        ctx.fillStyle = ctx.createPattern(tile,'repeat');
        ctx.translate(-grain.offset[0],-grain.offset[1]); ctx.fillRect(...grain.offset,w,h);
      } finally { ctx.restore(); }
    }
    glow(data.flood);
    if (data.white) { ctx.fillStyle = css(data.white); ctx.fillRect(0,0,w,h); }
    text(ctx,data.negative);
  } finally {
    ctx.restore();
    for (const canvas of surfaces) { canvas.width = 1; canvas.height = 1; }
  }
}
`;
