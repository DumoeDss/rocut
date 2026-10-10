/** Native Canvas boundaries used by the original Ink scene. These helpers
 * replay an admitted Rust plan; they do not calculate its geometry or timing. */
export const MV_ORDERED_RASTER_SOURCE = String.raw`
function mvCopyScaledTransform(ctx, operation) {
  if (!Number.isFinite(operation.scale) || operation.scale <= 0 || operation.scale > 8
    || !Array.isArray(operation.offset) || operation.offset.length !== 2
    || operation.offset.some(v => !Number.isFinite(v) || Math.abs(v) > 1000000))
    throw Error('Invalid native scaled Canvas transform copy');
  const m = ctx.getTransform(), s = operation.scale, [x,y] = operation.offset;
  ctx.setTransform(m.a*s,m.b*s,m.c*s,m.d*s,(m.e+x)*s,(m.f+y)*s);
}
function mvOrderedBlitFilter(raster) {
  if (!Number.isFinite(raster.blurPx) || raster.blurPx < 0 || raster.blurPx > 16
    || typeof raster.smoothing !== 'boolean'
    || !['low','medium','high'].includes(raster.smoothingQuality)
    || (raster.contrast !== undefined && (!Number.isFinite(raster.contrast)
      || raster.contrast < 0 || raster.contrast > 32)))
    throw Error('Invalid native blit raster settings');
  const filters = [];
  if (raster.blurPx !== 0) filters.push('blur(' + raster.blurPx + 'px)');
  if (raster.contrast !== undefined) filters.push('contrast(' + raster.contrast + ')');
  return filters.length ? filters.join(' ') : 'none';
}
function mvGradientRect(ctx, command) {
  if (command.paint.kind !== 'fill') throw Error('Native gradient rectangle requires fill paint');
  let brush;
  ctx.save();
  try {
    mvEmberTransform(ctx,{transform:command.styleTransform,operations:command.styleOperations});
    brush = mvEmberStyle(ctx,command.paint.style);
  } finally { ctx.restore(); }
  // save/restore preserves the exact native draw CTM. setTransform(getTransform())
  // here would introduce a precision boundary absent from the original scene.
  ctx.globalCompositeOperation = command.paint.composite;
  ctx.globalAlpha = command.paint.opacity;
  ctx.fillStyle = brush;
  ctx.fillRect(...command.rect);
}
`;
