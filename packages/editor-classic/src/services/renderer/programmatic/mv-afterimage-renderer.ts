/** Raster-only afterimage adapter. Rust owns time, noise, geometry and admission. */
export const MV_AFTERIMAGE_RENDERER_SOURCE = String.raw`
function drawMvAfterimage(ctx, data, assets, w, h, createSurface) {
  const buffers = [];
  const make = (width, height) => {
    const canvas = createSurface ? createSurface(width,height) : new OffscreenCanvas(width, height);
    buffers.push(canvas);
    return canvas;
  };
  const css = c => 'rgba(' + c.slice(0,3).map(v => v * 255).join(',') + ',' + c[3] + ')';
  const font = (id, size) => {
    const descriptor = assets.descriptor(id);
    if (descriptor.kind !== 'font' || !descriptor.font) throw Error('Afterimage requires a declared font');
    const f = descriptor.font;
    return f.style + ' ' + f.weight + ' ' + size + 'px ' + JSON.stringify(f.family);
  };
  const text = (target, spec, color) => {
    target.save();
    try {
      target.font = font(spec.font, spec.fontSize);
      target.letterSpacing = spec.tracking + 'px';
      target.textAlign = 'center'; target.textBaseline = 'middle';
      target.globalAlpha = spec.opacity; target.fillStyle = css(color);
      target.fillText(spec.text, ...spec.position);
    } finally { target.restore(); }
  };
  ctx.save();
  try {
    ctx.setTransform(1,0,0,1,0,0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = css(data.background); ctx.fillRect(0,0,w,h);
    const mask = make(w,h), mx = mask.getContext('2d'), spec = data.mask;
    mx.fillStyle = '#fff';
    mx.beginPath(); mx.arc(...spec.circle.center, spec.circle.radius, 0, Math.PI * 2); mx.fill();
    mx.save();
    try {
      mx.globalCompositeOperation = 'destination-out';
      mx.imageSmoothingEnabled = true; mx.imageSmoothingQuality = 'high';
      mx.drawImage(assets.image(spec.cutout.image), ...spec.cutout.rect);
    } finally { mx.restore(); }
    for (const glyph of spec.glyphs) {
      mx.save();
      try {
        // Match the author's ink-centered 1000px glyph space, not a font-size
        // baseline approximation. Font metrics are the only platform input.
        mx.font = font(spec.titleFont, 1000);
        mx.textAlign = 'left'; mx.textBaseline = 'alphabetic';
        const m = mx.measureText(glyph.text);
        mx.translate(...glyph.center);
        mx.scale(glyph.fontSize / 1000, glyph.fontSize / 1000);
        mx.fillText(glyph.text,
          -(m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2,
          -(m.actualBoundingBoxDescent - m.actualBoundingBoxAscent) / 2);
      } finally { mx.restore(); }
    }
    text(mx, spec.subtitle, [1,1,1,1]);
    const rasters = new Map([['mask', mask]]);
    for (const raster of data.rasters) {
      const input = rasters.get(raster.source);
      if (!input) throw Error('Afterimage raster dependency missing');
      const output = make(...raster.size), rx = output.getContext('2d');
      rx.filter = raster.blur > 0 ? 'blur(' + raster.blur + 'px)' : 'none';
      rx.drawImage(input, 0,0,...raster.size);
      if (raster.tint) {
        rx.filter = 'none'; rx.globalCompositeOperation = 'source-in';
        rx.fillStyle = css(raster.tint); rx.fillRect(0,0,...raster.size);
      }
      rasters.set(raster.id, output);
    }
    ctx.save();
    try {
      ctx.setTransform(...data.transform);
      ctx.imageSmoothingEnabled = true; ctx.globalCompositeOperation = 'lighter';
      for (const layer of data.layers) {
        const raster = rasters.get(layer.raster);
        if (!raster) throw Error('Afterimage layer raster missing');
        ctx.globalAlpha = layer.opacity; ctx.drawImage(raster, ...layer.rect);
      }
    } finally { ctx.restore(); }
    if (data.grain) {
      const grain = data.grain, tile = make(...grain.size), gx = tile.getContext('2d');
      const pixels = gx.createImageData(...grain.size);
      for (let i = 0; i < grain.gray.length; i++) {
        pixels.data[i*4] = pixels.data[i*4+1] = pixels.data[i*4+2] = grain.gray[i];
        pixels.data[i*4+3] = 255;
      }
      gx.putImageData(pixels,0,0);
      ctx.save();
      try {
        ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = grain.opacity;
        ctx.fillStyle = ctx.createPattern(tile,'repeat');
        ctx.translate(-grain.offset[0], -grain.offset[1]);
        ctx.fillRect(...grain.offset,w,h);
      } finally { ctx.restore(); }
    }
    text(ctx, data.credit, data.credit.color);
  } finally {
    ctx.restore();
    for (const canvas of buffers) { canvas.width = 1; canvas.height = 1; }
  }
}
`;
