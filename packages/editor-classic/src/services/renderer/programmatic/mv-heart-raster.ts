/** Native Canvas primitives for Rust-derived Heart images and shadows. A
 * prepared image is supplied by the render owner, never resolved as a URL or
 * an ordinary authored resource. This leaf does not segment or fracture art. */
export const MV_HEART_RASTER_SOURCE = String.raw`
function mvHeartPreparedImage(ctx, command, assets) {
  if (!assets || typeof assets.preparedImage !== 'function')
    throw Error('Heart requires an admitted prepared-image owner');
  const image = assets.preparedImage(command.image);
  if (!image || image.width !== command.image.width || image.height !== command.image.height)
    throw Error('Heart prepared raster dimensions mismatch');
  ctx.globalCompositeOperation = command.composite; ctx.globalAlpha = command.opacity;
  ctx.imageSmoothingEnabled = command.smoothing; ctx.imageSmoothingQuality = command.smoothingQuality;
  if (command.sourceRect) ctx.drawImage(image,...command.sourceRect,...command.destinationRect);
  else ctx.drawImage(image,...command.destinationRect);
}
function mvHeartShadowPath(ctx, command) {
  const shadow = command.shadow;
  if (!shadow || !Number.isFinite(shadow.blurPx) || shadow.blurPx < 0 || shadow.blurPx > 16
    || !Array.isArray(shadow.offset) || shadow.offset.length !== 2
    || shadow.offset.some(value => value !== 0))
    throw Error('Invalid admitted Heart shadow primitive');
  ctx.shadowColor = mvEmberCss(shadow.color); ctx.shadowBlur = shadow.blurPx;
  ctx.shadowOffsetX = shadow.offset[0]; ctx.shadowOffsetY = shadow.offset[1];
  mvEmberPath(ctx,command.path);
  for (const paint of command.paints) mvEmberPaint(ctx,paint);
}
`;
