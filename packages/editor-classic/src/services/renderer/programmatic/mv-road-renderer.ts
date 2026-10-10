/** Exact Canvas primitives only. Rust owns the world, projection, schedules,
 * particle loops, geometry and runner strips. No scene or raster fallback. */
export const MV_ROAD_RENDERER_SOURCE = String.raw`
function mvRoadCss(color) {
  return 'rgba(' + color.slice(0,3).map(value => value * 255).join(',') + ',' + color[3] + ')';
}
function mvRoadStyle(ctx, style) {
  if (style.kind === 'solid') return mvRoadCss(style.color);
  let gradient;
  if (style.kind === 'linear') gradient = ctx.createLinearGradient(...style.from,...style.to);
  else if (style.kind === 'radial') gradient = ctx.createRadialGradient(...style.from,...style.to);
  else throw Error('Unsupported Road native style');
  for (const [offset,color] of style.stops) gradient.addColorStop(offset,mvRoadCss(color));
  return gradient;
}
function* drawMvRoadSteps(ctx, plan, assets, createSurface, foreground) {
  if (ctx.canvas.width !== 1920 || ctx.canvas.height !== 1080
    || (foreground && (foreground.canvas.width !== 1920 || foreground.canvas.height !== 1080)))
    throw Error('Road native main/foreground dimensions must match admitted 1920x1080');
  const allocated = [], surfaces = new Map(), contexts = new Map([['main',ctx]]);
  const depth = new Map([['main',0]]);
  const initialize = target => {
    target.setTransform(1,0,0,1,0,0); target.globalAlpha = 1;
    target.globalCompositeOperation = 'source-over'; target.filter = 'none';
    target.shadowColor = 'rgba(0,0,0,0)'; target.shadowBlur = 0;
    target.shadowOffsetX = target.shadowOffsetY = 0;
    target.setLineDash([]); target.lineDashOffset = 0; target.miterLimit = 10;
    target.lineCap = 'butt'; target.lineJoin = 'miter'; target.lineWidth = 1;
    target.imageSmoothingEnabled = true; target.imageSmoothingQuality = 'low';
  };
  const surface = id => {
    const value = surfaces.get(id);
    if (!value) throw Error('Road requires a current live native scratch surface');
    return value;
  };
  const draw = (target, action, id) => {
    switch (action.kind) {
      case 'save': target.save(); depth.set(id,depth.get(id)+1); break;
      case 'restore':
        if (!depth.get(id)) throw Error('Road native state stack underflow');
        target.restore(); depth.set(id,depth.get(id)-1); break;
      case 'translate': target.translate(...action.offset); break;
      case 'rotate': target.rotate(action.radians); break;
      case 'scale': target.scale(...action.factors); break;
      case 'transform': target.setTransform(...action.matrix); break;
      case 'alpha': target.globalAlpha = action.value; break;
      case 'composite': target.globalCompositeOperation = action.value; break;
      case 'filter': target.filter = action.blurPx === 0 ? 'none' : 'blur(' + action.blurPx + 'px)'; break;
      case 'smoothing': target.imageSmoothingEnabled = true; target.imageSmoothingQuality = action.quality; break;
      case 'fillStyle': target.fillStyle = mvRoadStyle(target,action.style); break;
      case 'strokeStyle': target.strokeStyle = mvRoadStyle(target,action.style); break;
      case 'lineWidth': target.lineWidth = action.value; break;
      case 'lineCap': target.lineCap = action.value; break;
      case 'lineJoin': target.lineJoin = action.value; break;
      case 'beginPath': target.beginPath(); break;
      case 'moveTo': target.moveTo(...action.point); break;
      case 'lineTo': target.lineTo(...action.point); break;
      case 'bezierCurveTo': target.bezierCurveTo(...action.control1,...action.control2,...action.point); break;
      case 'arc': target.arc(...action.center,action.radius,action.start,action.end); break;
      case 'ellipse': target.ellipse(...action.center,...action.radii,action.rotation,action.start,action.end); break;
      case 'rectPath': target.rect(...action.rect); break;
      case 'closePath': target.closePath(); break;
      case 'clip': target.clip(); break;
      case 'fill': target.fill(); break;
      case 'stroke': target.stroke(); break;
      case 'fillRect': target.fillRect(...action.rect); break;
      case 'image': {
        let source;
        if (action.sourceKind === 'surface') source = surface(action.source);
        else if (action.sourceKind === 'asset') {
          if (!assets || assets.descriptor(action.source).kind !== 'image') throw Error('Road requires an explicitly admitted image');
          source = assets.image(action.source);
        } else throw Error('Unsupported Road native image provenance');
        if (source === target.canvas) throw Error('Road native scratch feedback is forbidden');
        if (action.sourceRect) target.drawImage(source,...action.sourceRect,...action.destinationRect);
        else if (action.intrinsic) target.drawImage(source,...action.destinationRect.slice(0,2));
        else target.drawImage(source,...action.destinationRect);
        break;
      }
      default: throw Error('Unsupported Road native primitive');
    }
  };
  ctx.save();
  try {
    initialize(ctx);
    for (const command of plan.commands) {
      if (command.kind === 'surface') {
        if (contexts.has(command.id)) throw Error('Duplicate live Road surface');
        const canvas = createSurface ? createSurface(...command.size) : new OffscreenCanvas(...command.size);
        allocated.push(canvas);
        if (canvas.width !== command.size[0] || canvas.height !== command.size[1])
          throw Error('Road allocated scratch dimensions mismatch');
        const target = canvas.getContext('2d');
        if (!target) throw Error('Road requires native Canvas2D');
        initialize(target); surfaces.set(command.id,canvas); contexts.set(command.id,target); depth.set(command.id,0);
      } else if (command.kind === 'release') {
        const canvas = surface(command.surface);
        if (depth.get(command.surface)) throw Error('Road scratch native stack leaked');
        canvas.width = canvas.height = 1; surfaces.delete(command.surface); contexts.delete(command.surface); depth.delete(command.surface);
      } else if (command.kind === 'capture') {
        const target = contexts.get(command.surface);
        if (!target || target === ctx) throw Error('Road refraction requires a distinct admitted target');
        target.drawImage(ctx.canvas,...command.sourceRect,...command.destinationRect);
      } else if (command.kind === 'foreground') {
        const source = surface(command.surface);
        if (foreground && foreground !== ctx) {
          foreground.save();
          try { foreground.setTransform(ctx.getTransform()); foreground.drawImage(source,0,0); }
          finally { foreground.restore(); }
        }
      } else if (command.kind === 'native') {
        const target = contexts.get(command.target);
        if (!target) throw Error('Road native target unavailable');
        draw(target,command.action,command.target);
      } else throw Error('Unsupported Road native graph command');
      yield;
    }
    if (depth.get('main') || surfaces.size) throw Error('Road native graph leaked scratch/state');
  } finally {
    while (depth.get('main') > 0) { ctx.restore(); depth.set('main',depth.get('main')-1); }
    ctx.restore();
    for (const canvas of allocated) canvas.width = canvas.height = 1;
    surfaces.clear(); contexts.clear(); depth.clear();
  }
}
function drawMvRoad(ctx,plan,assets,createSurface,foreground) {
  for (const _ of drawMvRoadSteps(ctx,plan,assets,createSurface,foreground)) {}
}
`;
