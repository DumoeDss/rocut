/** Each iterator owns only frame scratch, never provider bitmaps. */
export const MV_HEART_LIFETIME_SOURCE = String.raw`
function* drawMvHeartSteps(ctx, data, assets, createSurface, reuseReleasedIds = false) {
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
  const draw = (target, command, scratchTarget = false) => mvHeartDraw(target,command,assets,scratch,make,scratchTarget);
  function* children(target, commands) {
    for (const child of commands) {
      if (child.kind === 'surface') throw Error('Nested Heart scratch operations are not supported');
      if (child.kind === 'releaseSurface') throw Error('Heart scratch release is only allowed at the root');
      if (child.kind === 'appendSurface') throw Error('Heart scratch append is only allowed at the root');
      draw(target,child,true);
      yield;
    }
  }
  ctx.save();
  try {
    initialize(ctx);
    for (const command of data.commands) {
      if (command.kind === 'releaseSurface') {
        const surface = scratch.get(command.surface);
        if (!surface) throw Error('Release requires a completed live Heart scratch surface');
        surface.width = 1; surface.height = 1; scratch.delete(command.surface);
        // Rust Sky's bounded sprite stream releases each piece before reusing
        // its slot. Ordinary Heart retains its immutable per-frame ID policy.
        if (reuseReleasedIds) seen.delete(command.surface);
        yield; continue;
      }
      if (command.kind === 'appendSurface') {
        const surface = scratch.get(command.surface);
        if (!surface) throw Error('Append requires a completed live Heart scratch surface');
        const target = surface.getContext('2d');
        if (!target) throw Error('Heart scratch surface requires Canvas2D');
        // Same owned canvas/context; no copy, clear, resize or state reset.
        // Unpublish while drawing so self-blits/patterns cannot sample it.
        scratch.delete(command.surface);
        yield* children(target,command.commands);
        scratch.set(command.surface,surface);
        yield; continue;
      }
      if (command.kind !== 'surface') { draw(ctx,command); yield; continue; }
      if (seen.has(command.id)) throw Error('Duplicate Heart scratch surface');
      seen.add(command.id);
      const surface = make(command.size), target = surface.getContext('2d');
      if (!target) throw Error('Heart scratch surface requires Canvas2D');
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
function drawMvHeart(ctx, data, assets, createSurface, reuseReleasedIds = false) {
  for (const _ of drawMvHeartSteps(ctx,data,assets,createSurface,reuseReleasedIds)) {}
}
`;
