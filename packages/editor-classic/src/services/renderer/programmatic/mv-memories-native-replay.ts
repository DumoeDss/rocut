// @ts-nocheck
// Fixed compiled replay, copied mechanically from shipped ordered/Ember/Memories
// source. No authored source or runtime code compilation participates.

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


function mvEmberCss(color) {
  return 'rgba(' + color.slice(0,3).map(value => value * 255).join(',') + ',' + color[3] + ')';
}
function mvEmberTransform(ctx, command) {
  ctx.setTransform(...command.transform);
  for (const operation of command.operations || []) {
    if (operation.kind === 'translate') ctx.translate(...operation.offset);
    else if (operation.kind === 'rotate') ctx.rotate(operation.radians);
    else if (operation.kind === 'scale') ctx.scale(...operation.factors);
    else if (operation.kind === 'copyTransform') ctx.setTransform(ctx.getTransform());
    else if (operation.kind === 'copyScaledTransform') mvCopyScaledTransform(ctx,operation);
    else throw Error('Unsupported Ember transform operation');
  }
}
function mvEmberPath(ctx, steps) {
  ctx.beginPath();
  for (const step of steps) {
    if (step.kind === 'moveTo') ctx.moveTo(...step.point);
    else if (step.kind === 'lineTo') ctx.lineTo(...step.point);
    else if (step.kind === 'quadraticCurveTo') ctx.quadraticCurveTo(...step.control,...step.point);
    else if (step.kind === 'rect') ctx.rect(...step.rect);
    else if (step.kind === 'close') ctx.closePath();
    else if (step.kind === 'arc') ctx.arc(...step.center,step.radius,step.start,step.end,step.anticlockwise ?? false);
    else if (step.kind === 'ellipse') ctx.ellipse(...step.center,...step.radii,step.rotation,step.start,step.end,step.anticlockwise ?? false);
    else throw Error('Unsupported Ember path step');
  }
}
function mvEmberCirclePath(ctx, circles) {
  ctx.beginPath();
  for (const circle of circles) {
    ctx.moveTo(circle[0]+circle[2],circle[1]);
    ctx.arc(circle[0],circle[1],circle[2],0,6.283185307179586,false);
  }
}
function mvEmberStyle(ctx, spec) {
  if (spec.kind === 'solid') return mvEmberCss(spec.color);
  let gradient;
  if (spec.kind === 'linear') gradient = ctx.createLinearGradient(...spec.from,...spec.to);
  else if (spec.kind === 'radial') gradient = ctx.createRadialGradient(...spec.from,...spec.to);
  else throw Error('Unsupported Ember paint style');
  for (const stop of spec.stops) gradient.addColorStop(stop.offset,mvEmberCss(stop.color));
  return gradient;
}
function mvEmberPaint(ctx, spec, rect) {
  ctx.globalCompositeOperation = spec.composite; ctx.globalAlpha = spec.opacity;
  const brush = mvEmberStyle(ctx,spec.style);
  if (spec.kind === 'fill') {
    ctx.fillStyle = brush;
    if (rect) ctx.fillRect(...rect); else ctx.fill();
  } else if (spec.kind === 'stroke') {
    ctx.strokeStyle = brush; ctx.lineWidth = spec.width;
    ctx.lineCap = spec.cap; ctx.lineJoin = spec.join;
    if (rect) ctx.strokeRect(...rect); else ctx.stroke();
  } else throw Error('Unsupported Ember paint operation');
}
function mvEmberFont(ctx, command, assets) {
  const resource = assets.descriptor(command.font);
  if (resource.kind !== 'font' || !resource.font) throw Error('Ember text requires a declared loaded font');
  const font = resource.font;
  if (command.tracking !== 0 && !('letterSpacing' in ctx)) throw Error('Canvas does not support Ember tracking');
  ctx.font = font.style + ' ' + font.weight + ' ' + command.fontSize + 'px ' + JSON.stringify(font.family);
  ctx.letterSpacing = command.tracking + 'px';
  ctx.textAlign = command.align; ctx.textBaseline = command.baseline;
  ctx.direction = 'ltr'; ctx.fontKerning = 'auto'; ctx.wordSpacing = '0px';
  ctx.fontStretch = 'normal'; ctx.fontVariantCaps = 'normal'; ctx.textRendering = 'auto';
}
function mvEmberText(ctx, command, assets) {
  mvEmberFont(ctx,command,assets);
  if (command.kind === 'textStroke') {
    if (!Number.isFinite(command.blurPx) || command.blurPx < 0 || command.blurPx > 16
      || !Number.isFinite(command.width) || command.width <= 0 || command.width > 8192
      || !['butt','round'].includes(command.cap) || !['miter','round'].includes(command.join))
      throw Error('Invalid native text stroke settings');
    ctx.strokeStyle = mvEmberStyle(ctx,command.style);
    ctx.lineWidth = command.width; ctx.lineCap = command.cap; ctx.lineJoin = command.join;
    ctx.filter = command.blurPx === 0 ? 'none' : 'blur(' + command.blurPx + 'px)';
    ctx.globalAlpha = command.opacity; ctx.globalCompositeOperation = command.composite;
    ctx.strokeText(command.text,...command.position); return;
  }
  ctx.fillStyle = command.style ? mvEmberStyle(ctx,command.style) : mvEmberCss(command.color);
  ctx.globalAlpha = command.opacity; ctx.globalCompositeOperation = command.composite;
  ctx.fillText(command.text,...command.position);
}
function mvEmberGrain(ctx, command, make) {
  const tile = make(command.size), target = tile.getContext('2d');
  if (!target) throw Error('Ember grain requires Canvas2D');
  const pixels = target.createImageData(...command.size);
  for (let index = 0; index < command.gray.length; index++) {
    pixels.data[index*4] = pixels.data[index*4+1] = pixels.data[index*4+2] = command.gray[index];
    pixels.data[index*4+3] = 255;
  }
  target.putImageData(pixels,0,0);
  if (command.fillHistory !== undefined) {
    // Canvas paint history can affect a later pattern despite identical public
    // state. Rust supplies the reference assignment, never a synthetic primer.
    const matrix = ctx.getTransform();
    try {
      ctx.setTransform(...command.fillHistory.transform);
      ctx.fillStyle = mvEmberStyle(ctx,command.fillHistory.style);
    } finally { ctx.setTransform(matrix); }
  }
  const pattern = ctx.createPattern(tile,'repeat');
  if (!pattern) throw Error('Ember grain pattern unavailable');
  ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = command.opacity;
  ctx.fillStyle = pattern; ctx.fillRect(...command.rect);
}
function mvEmberGrayPixels(ctx, command) {
  mvEmberPixels(ctx,command,false);
}
function mvEmberPixels(ctx, command, alpha) {
  const size = command.size, gray = alpha ? command.alpha : command.gray, position = command.position;
  if (!Array.isArray(size) || size.length !== 2 || size.some(n => !Number.isInteger(n) || n <= 0 || n > 4294967295)
    || !Number.isSafeInteger(size[0]*size[1]) || !Array.isArray(gray) || gray.length !== size[0]*size[1]
    || !Array.isArray(position) || position.length !== 2 || position.some(n => !Number.isInteger(n) || n < -2147483648 || n > 2147483647)
    || gray.some(n => !Number.isInteger(n) || n < 0 || n > 255))
    throw Error((alpha ? 'Alpha' : 'Gray') + ' pixels require exact native dimensions, bytes and position');
  // Native admission owns the pixel budget; this checks transport consistency.
  const pixels = ctx.createImageData(...size);
  for (let index = 0; index < gray.length; index++) {
    pixels.data[index*4] = pixels.data[index*4+1] = pixels.data[index*4+2] = alpha ? 255 : gray[index];
    pixels.data[index*4+3] = alpha ? gray[index] : 255;
  }
  ctx.putImageData(pixels,...position);
}
function mvEmberRectBatch(ctx, command) {
  const spec = command.paint;
  if (spec.kind !== 'fill') throw Error('Native rectangle batches require fill paint');
  ctx.globalCompositeOperation = spec.composite; ctx.globalAlpha = spec.opacity;
  ctx.fillStyle = mvEmberStyle(ctx,spec.style);
  for (const rect of command.rects) ctx.fillRect(...rect);
}
function mvEmberFilteredRect(ctx, command) {
  const spec = command.paint, identity = [1,0,0,1,0,0];
  if (!Array.isArray(command.transform) || command.transform.length !== 6
    || command.transform.some((v,i) => v !== identity[i])
    || (command.operations !== undefined && (!Array.isArray(command.operations) || command.operations.length !== 0))
    || command.clip != null || !Array.isArray(command.rect) || command.rect.length !== 4
    || command.rect.some((v,i) => !Number.isFinite(v) || Math.abs(v) > (i < 2 ? 1000000 : 8192))
    || spec.kind !== 'fill' || !['source-over','lighter'].includes(spec.composite)
    || !Number.isFinite(spec.opacity) || spec.opacity < 0 || spec.opacity > 1
    || !Number.isFinite(command.blurPx) || command.blurPx < 0 || command.blurPx > 16)
    throw Error('Invalid native identity filtered fillRect');
  ctx.setTransform(...identity);
  ctx.globalCompositeOperation = spec.composite; ctx.globalAlpha = spec.opacity;
  ctx.fillStyle = mvEmberStyle(ctx,spec.style);
  ctx.filter = command.blurPx === 0 ? 'none' : 'blur(' + command.blurPx + 'px)';
  ctx.fillRect(...command.rect);
}


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

export const memoriesNativeReplay = Object.freeze({draw:drawMvMemories,measure:measureMvMemoriesFonts});

