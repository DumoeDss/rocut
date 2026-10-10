import { MV_EMBER_RASTER_SOURCE } from "./mv-ember-raster";

/** Native replay only. The owner resolves opaque Rust-bound RGBA and loaded
 * fonts; no URL fallback, scene mathematics, image analysis or pixel synthesis. */
export const MV_MEMORIES_RENDERER_SOURCE =
	MV_EMBER_RASTER_SOURCE +
	String.raw`
function measureMvMemoriesFonts(ctx, requests, assets) {
  ctx.save();
  try {
    return requests.map(request => {
      const descriptor = assets.descriptor(request.font);
      if (descriptor.kind !== 'font' || !descriptor.font
        || descriptor.font.weight !== request.weight || descriptor.font.style !== 'normal')
        throw Error('Memories measurements require the exact admitted font face');
      mvEmberFont(ctx,{...request,tracking:0,align:'left',baseline:'alphabetic'},assets);
      const widths = Object.create(null);
      for (const text of request.texts) widths[text] = ctx.measureText(text).width;
      return {font:request.font,fontSize:request.fontSize,weight:request.weight,widths};
    });
  } finally { ctx.restore(); }
}
function* drawMvMemoriesSteps(ctx, data, assets, createSurface) {
  const allocated = [], scratch = new Map(), seen = new Set();
  const initialize = target => {
    target.filter = 'none'; target.shadowColor = 'rgba(0,0,0,0)';
    target.shadowBlur = 0; target.shadowOffsetX = target.shadowOffsetY = 0;
    target.setLineDash([]); target.lineDashOffset = 0; target.miterLimit = 10;
    target.imageSmoothingEnabled = true; target.imageSmoothingQuality = 'low';
  };
  const make = size => {
    const canvas = createSurface ? createSurface(...size) : new OffscreenCanvas(...size);
    allocated.push(canvas); return canvas;
  };
  const image = raster => {
    if (!assets || typeof assets.memoriesRaster !== 'function')
      throw Error('Memories requires its admitted raster owner');
    const source = assets.memoriesRaster(raster);
    if (!source || source.width !== raster.width || source.height !== raster.height)
      throw Error('Memories native raster dimensions mismatch');
    return source;
  };
  const draw = (target, command) => {
    target.save();
    try {
      if (command.kind === 'pixels') {
        if (!assets || typeof assets.memoriesPixels !== 'function')
          throw Error('Memories requires its admitted RGBA owner');
        const pixels = assets.memoriesPixels(command.raster);
        if (!pixels || pixels.width !== command.raster.width || pixels.height !== command.raster.height
          || pixels.data.length !== pixels.width * pixels.height * 4)
          throw Error('Memories admitted RGBA dimensions mismatch');
        target.putImageData(pixels,0,0); return;
      }
      if (command.clip) {
        mvEmberTransform(target,command.clip);
        mvEmberPath(target,command.clip.path); target.clip('nonzero');
      }
      mvEmberTransform(target,command);
      if (command.kind === 'filteredRect' || command.kind === 'filteredPath') {
        if (command.affine) target.transform(...command.affine);
        target.filter = command.blurPx === 0 ? 'none' : 'blur(' + command.blurPx + 'px)';
        if (command.kind === 'filteredRect') mvEmberPaint(target,command.paint,command.rect);
        else {
          mvEmberPath(target,command.path);
          for (const paint of command.paints) mvEmberPaint(target,paint);
        }
      } else if (command.kind === 'roundRect') {
        target.beginPath(); target.roundRect(...command.rect,command.radius);
        mvEmberPaint(target,command.paint);
      } else if (command.kind === 'clippedText') {
        mvEmberFont(target,{...command,tracking:0,align:'left',baseline:'alphabetic'},assets);
        target.fillStyle = mvEmberCss(command.color);
        target.globalAlpha = command.opacity; target.globalCompositeOperation = 'source-over';
        target.fillText(command.text,...command.position);
      } else if (command.kind === 'preparedImage') {
        target.globalCompositeOperation = command.composite; target.globalAlpha = command.opacity;
        target.imageSmoothingEnabled = true; target.imageSmoothingQuality = command.smoothingQuality;
        target.drawImage(image(command.raster),...command.destinationRect);
      } else if (command.kind === 'image') {
        if (assets.descriptor(command.image).kind !== 'image') throw Error('Memories requires an admitted image');
        target.globalCompositeOperation = command.composite; target.globalAlpha = command.opacity;
        target.imageSmoothingEnabled = command.smoothing; target.imageSmoothingQuality = command.smoothingQuality;
        if (command.sourceRect) target.drawImage(assets.image(command.image),...command.sourceRect,...command.destinationRect);
        else target.drawImage(assets.image(command.image),...command.destinationRect);
      } else if (command.kind === 'blit') {
        const source = scratch.get(command.surface);
        if (!source || source === target.canvas) throw Error('Memories requires an earlier completed surface');
        target.globalCompositeOperation = command.composite; target.globalAlpha = command.opacity;
        if (command.raster) {
          target.filter = mvOrderedBlitFilter(command.raster);
          target.imageSmoothingEnabled = command.raster.smoothing;
          target.imageSmoothingQuality = command.raster.smoothingQuality;
        }
        target.drawImage(source,...command.sourceRect,...command.destinationRect);
      } else if (command.kind === 'path') {
        mvEmberPath(target,command.path);
        for (const paint of command.paints) mvEmberPaint(target,paint);
      } else if (command.kind === 'rect') mvEmberPaint(target,command.paint,command.rect);
      else throw Error('Unsupported admitted Memories primitive');
    } finally { target.restore(); }
  };
  function* commands(target, list) {
    for (const command of list) {
      if (command.kind === 'surface') {
        if (seen.has(command.id)) throw Error('Duplicate Memories surface');
        seen.add(command.id);
        const surface = make(command.size), child = surface.getContext('2d');
        if (!child) throw Error('Memories requires Canvas2D');
        initialize(child); yield* commands(child,command.commands);
        scratch.set(command.id,surface);
      } else if (command.kind === 'releaseSurface') {
        const surface = scratch.get(command.surface);
        if (!surface || surface === target.canvas) throw Error('Invalid Memories surface release');
        surface.width = surface.height = 1; scratch.delete(command.surface); seen.delete(command.surface);
      } else draw(target,command);
      yield;
    }
  }
  ctx.save();
  try { initialize(ctx); yield* commands(ctx,data.commands); }
  finally {
    ctx.restore();
    for (const surface of allocated) surface.width = surface.height = 1;
    scratch.clear(); seen.clear();
  }
}
function drawMvMemories(ctx,data,assets,createSurface) {
  for (const _ of drawMvMemoriesSteps(ctx,data,assets,createSurface)) {}
}
`;
