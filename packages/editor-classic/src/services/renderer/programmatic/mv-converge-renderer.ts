/** Raster-only converge adapter. Rust supplies ordered geometry, absolute output
 * base CTMs/native transform steps, paint state and grain bytes; no author
 * timing/randomness or transform trigonometry is evaluated here.
 */
export const MV_CONVERGE_RENDERER_SOURCE = String.raw`
function drawMvConverge(ctx, data, createSurface) {
  const surfaces = [];
  const css = color => 'rgba(' + color.slice(0,3).map(value => value * 255).join(',') + ',' + color[3] + ')';
  const style = spec => {
    if (spec.kind === 'solid') return css(spec.color);
    let gradient;
    if (spec.kind === 'linear') gradient = ctx.createLinearGradient(...spec.from,...spec.to);
    else if (spec.kind === 'radial') gradient = ctx.createRadialGradient(...spec.from,...spec.to);
    else throw Error('Unsupported converge paint style');
    for (const stop of spec.stops) gradient.addColorStop(stop.offset,css(stop.color));
    return gradient;
  };
  const paint = (spec, rect) => {
    ctx.globalCompositeOperation = spec.composite; ctx.globalAlpha = spec.opacity;
    // Canvas gradients retain their creation CTM: construct after the command's
    // transform, including the local shard and anamorphic-ember transforms.
    const brush = style(spec.style);
    if (spec.kind === 'fill') {
      ctx.fillStyle = brush;
      if (rect) ctx.fillRect(...rect); else ctx.fill();
    } else if (spec.kind === 'stroke' && !rect) {
      ctx.strokeStyle = brush; ctx.lineWidth = spec.width;
      ctx.lineCap = spec.cap; ctx.lineJoin = spec.join; ctx.stroke();
    } else throw Error('Unsupported converge paint operation');
  };
  const path = steps => {
    ctx.beginPath();
    for (const step of steps) {
      if (step.kind === 'moveTo') ctx.moveTo(...step.point);
      else if (step.kind === 'lineTo') ctx.lineTo(...step.point);
      else if (step.kind === 'close') ctx.closePath();
      else if (step.kind === 'arc') ctx.arc(...step.center,step.radius,step.start,step.end);
      else if (step.kind === 'ellipse') ctx.ellipse(...step.center,...step.radii,step.rotation,step.start,step.end);
      else throw Error('Unsupported converge path step');
    }
  };
  const grain = command => {
    const tile = createSurface ? createSurface(...command.size) : new OffscreenCanvas(...command.size); surfaces.push(tile);
    const target = tile.getContext('2d');
    if (!target) throw Error('Converge grain requires Canvas2D');
    const pixels = target.createImageData(...command.size);
    for (let index = 0; index < command.gray.length; index++) {
      pixels.data[index*4] = pixels.data[index*4+1] = pixels.data[index*4+2] = command.gray[index];
      pixels.data[index*4+3] = 255;
    }
    target.putImageData(pixels,0,0);
    const pattern = ctx.createPattern(tile,'repeat');
    if (!pattern) throw Error('Converge grain pattern unavailable');
    ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = command.opacity;
    ctx.fillStyle = pattern; ctx.fillRect(...command.rect);
  };
  ctx.save();
  try {
    ctx.filter = 'none'; ctx.shadowColor = 'rgba(0,0,0,0)';
    ctx.setLineDash([]); ctx.lineDashOffset = 0; ctx.miterLimit = 10;
    for (const command of data.commands) {
      ctx.save();
      try {
        // Includes Rust's 1920x1080 design-space mapping. Grain/white-out may
        // instead supply pixel-identity transforms; never rescale them here.
        ctx.setTransform(...command.transform);
        // Preserve Canvas's per-operation precision: setTransform of a flattened
        // translate/rotate/scale matrix quantizes rotation coefficients differently.
        for (const operation of command.operations || []) {
          if (operation.kind === 'translate') ctx.translate(...operation.offset);
          else if (operation.kind === 'rotate') ctx.rotate(operation.radians);
          else if (operation.kind === 'scale') ctx.scale(...operation.factors);
          else if (operation.kind === 'copyTransform') ctx.setTransform(ctx.getTransform());
          else throw Error('Unsupported converge transform operation');
        }
        if (command.kind === 'path') {
          path(command.path);
          // Reuse one path for ordered strokes/fills. Combining distinct paths
          // or beginning again between paints changes additive intersections.
          for (const spec of command.paints) paint(spec);
        } else if (command.kind === 'rect') paint(command.paint,command.rect);
        else if (command.kind === 'grain') grain(command);
        else throw Error('Unsupported converge command');
      } finally { ctx.restore(); }
    }
  } finally {
    ctx.restore();
    for (const canvas of surfaces) { canvas.width = 1; canvas.height = 1; }
  }
}
`;
