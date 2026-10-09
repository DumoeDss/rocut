/** Raster-only adapter for the validated, deterministic Rust text plan. */
export const MV_ASCII_SWEEP_RENDERER_SOURCE = String.raw`
function drawMvAsciiSweep(ctx, data, assets) {
  const font = assets.descriptor(data.font);
  if (font.kind !== 'font' || !font.font) throw Error('ASCII Sweep requires a declared font');
  const family = JSON.stringify(font.font.family);
  const css = c => 'rgba(' + c.slice(0,3).map(v => v*255).join(',') + ',' + c[3] + ')';
  ctx.save();
  ctx.font = font.font.style + ' ' + font.font.weight + ' ' + data.fontSize + 'px ' + family;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const glyph of data.glyphs) {
    ctx.globalAlpha = glyph.opacity;
    ctx.fillStyle = css(glyph.active ? data.activeColor : data.color);
    ctx.fillText(glyph.text, glyph.x, glyph.y, data.cellWidth);
  }
  ctx.restore();
}
`;
