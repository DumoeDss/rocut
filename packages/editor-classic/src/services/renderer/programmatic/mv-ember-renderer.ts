import { MV_EMBER_RASTER_SOURCE } from "./mv-ember-raster";

/** Replay a Rust frame plan. Scratch surfaces are private to this call; decoded
 * attachment images/fonts remain owned by the sandbox resource lifecycle.
 * A steps consumer owns the target until completion and must return/throw into
 * the iterator when cancelling. Each yield follows a complete atomic command.
 */
export const MV_EMBER_RENDERER_SOURCE =
	MV_EMBER_RASTER_SOURCE +
	String.raw`
function* drawMvEmberSteps(ctx, data, assets, createSurface) {
  const allocated = [], scratch = new Map();
  const seen = new Set();
  const make = size => {
    if (createSurface) { const canvas = createSurface(...size); allocated.push(canvas); return canvas; }
    const canvas = new OffscreenCanvas(...size); allocated.push(canvas); return canvas;
  };
  const initialize = target => {
    target.filter = 'none'; target.shadowColor = 'rgba(0,0,0,0)';
    target.setLineDash([]); target.lineDashOffset = 0; target.miterLimit = 10;
    target.imageSmoothingEnabled = true; target.imageSmoothingQuality = 'low';
  };
  const draw = (target, command) => {
    target.save();
    try {
      if (command.kind === 'grayPixels') { mvEmberGrayPixels(target,command); return; }
      if (command.kind === 'alphaPixels') { mvEmberPixels(target,command,true); return; }
      if (command.kind === 'filteredRect') { mvEmberFilteredRect(target,command); return; }
      if (command.clip) {
        mvEmberTransform(target,command.clip);
        mvEmberPath(target,command.clip.path); target.clip('nonzero');
      }
      mvEmberTransform(target,command);
      if (command.kind === 'path' || command.kind === 'circleBatch') {
        if (command.kind === 'path') mvEmberPath(target,command.path);
        else mvEmberCirclePath(target,command.circles);
        for (const spec of command.paints) mvEmberPaint(target,spec);
      } else if (command.kind === 'rect') mvEmberPaint(target,command.paint,command.rect);
      else if (command.kind === 'rectBatch') mvEmberRectBatch(target,command);
      else if (command.kind === 'grain') mvEmberGrain(target,command,make);
      else if (command.kind === 'text' || command.kind === 'textStroke') mvEmberText(target,command,assets);
      else if (command.kind === 'image') {
        if (assets.descriptor(command.image).kind !== 'image') throw Error('Ember image requires a declared image');
        target.globalCompositeOperation = command.composite; target.globalAlpha = command.opacity;
        target.imageSmoothingEnabled = command.smoothing; target.imageSmoothingQuality = command.smoothingQuality;
        if (command.sourceRect) target.drawImage(assets.image(command.image),...command.sourceRect,...command.destinationRect);
        else target.drawImage(assets.image(command.image),...command.destinationRect);
      } else if (command.kind === 'surfacePatternRect') {
        const source = scratch.get(command.surface);
        if (!source) throw Error('Pattern requires an earlier completed live Ember scratch surface');
        const pattern = target.createPattern(source,'repeat');
        if (!pattern) throw Error('Native surface pattern unavailable');
        target.globalCompositeOperation = command.composite; target.globalAlpha = command.opacity;
        target.imageSmoothingEnabled = command.smoothing; target.imageSmoothingQuality = command.smoothingQuality;
        target.fillStyle = pattern; target.fillRect(...command.rect);
      } else if (command.kind === 'blit') {
        const source = scratch.get(command.surface);
        if (!source) throw Error('Ember blit requires an earlier scratch surface');
        target.globalCompositeOperation = command.composite; target.globalAlpha = command.opacity;
        if (command.raster) {
          const r = command.raster;
          if (!Number.isFinite(r.blurPx) || r.blurPx < 0 || r.blurPx > 16 || typeof r.smoothing !== 'boolean'
            || !['low','medium','high'].includes(r.smoothingQuality)) throw Error('Invalid native blit raster settings');
          target.filter = r.blurPx === 0 ? 'none' : 'blur(' + r.blurPx + 'px)';
          target.imageSmoothingEnabled = r.smoothing; target.imageSmoothingQuality = r.smoothingQuality;
        }
        target.drawImage(source,...command.sourceRect,...command.destinationRect);
      } else throw Error('Unsupported Ember draw command');
    } finally { target.restore(); }
  };
  function* children(target, commands) {
    for (const child of commands) {
      if (child.kind === 'surface') throw Error('Nested Ember scratch operations are not supported');
      if (child.kind === 'releaseSurface') throw Error('Ember scratch release is only allowed at the root');
      if (child.kind === 'appendSurface') throw Error('Ember scratch append is only allowed at the root');
      draw(target,child);
      yield;
    }
  }
  ctx.save();
  try {
    initialize(ctx);
    for (const command of data.commands) {
      if (command.kind === 'releaseSurface') {
        const surface = scratch.get(command.surface);
        if (!surface) throw Error('Release requires a completed live Ember scratch surface');
        surface.width = 1; surface.height = 1; scratch.delete(command.surface);
        yield; continue;
      }
      if (command.kind === 'appendSurface') {
        const surface = scratch.get(command.surface);
        if (!surface) throw Error('Append requires a completed live Ember scratch surface');
        const target = surface.getContext('2d');
        if (!target) throw Error('Ember scratch surface requires Canvas2D');
        // Same owned canvas/context; no copy, clear, resize or state reset.
        // Unpublish while drawing so self-blits/patterns cannot sample it.
        scratch.delete(command.surface);
        yield* children(target,command.commands);
        scratch.set(command.surface,surface);
        yield; continue;
      }
      if (command.kind !== 'surface') { draw(ctx,command); yield; continue; }
      if (seen.has(command.id)) throw Error('Duplicate Ember scratch surface');
      seen.add(command.id);
      const surface = make(command.size), target = surface.getContext('2d');
      if (!target) throw Error('Ember scratch surface requires Canvas2D');
      initialize(target);
      // Only earlier, fully drawn surfaces are available for sampling.
      yield* children(target,command.commands);
      scratch.set(command.id,surface);
      yield;
    }
  } finally {
    ctx.restore();
    for (const surface of allocated) { surface.width = 1; surface.height = 1; }
    scratch.clear();
    seen.clear();
  }
}
function drawMvEmber(ctx, data, assets, createSurface) {
  for (const _ of drawMvEmberSteps(ctx,data,assets,createSurface)) {}
}
`;
