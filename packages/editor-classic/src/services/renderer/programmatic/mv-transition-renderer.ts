import { MV_SURFACE_RENDERER_SOURCE } from "./mv-surface-renderer";

/** Graphics backend only: validated Rust plans own all timing, randomness and
 * geometry. Every operation is scoped; styles cannot become authored code. */
export const MV_TRANSITION_RENDERER_SOURCE =
	MV_SURFACE_RENDERER_SOURCE +
	String.raw`
function drawMvTransition(ctx, commands, a, b, role, w, h, kind) {
  if (!Array.isArray(commands)) throw Error('MV transitions require the matching rebuilt Rocut WASM runtime');
  if((kind==='bend'&&commands.some(op=>op.clip?.kind==='polygons'))||commands.some(op=>op.kind==='mesh')) { drawMvMeshTransition(ctx,commands,a,b,w,h); return; }
  if(commands.some(op=>op.kind==='surface')) { drawMvSurfaces(ctx,commands,a,b,w,h); return; }
  const color = c => 'rgba(' + c.slice(0,3).map(v => v * 255).join(',') + ',' + c[3] + ')';
  const path = shape => {
    ctx.beginPath();
    if (shape.kind === 'rect') ctx.rect(shape.x, shape.y, shape.width, shape.height);
    else if (shape.kind === 'circle') ctx.arc(shape.x, shape.y, shape.radius, 0, Math.PI * 2);
    else if (shape.kind === 'polygons') {
      for (const ring of shape.points) {
        ctx.moveTo(ring[0][0], ring[0][1]);
        for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i][0], ring[i][1]);
        ctx.closePath();
      }
    } else throw Error('Unsupported MV clip path');
  };
  for (const op of commands) {
    if (op.role && op.role !== role) continue;
    ctx.save();
    try {
      ctx.globalAlpha = op.opacity;
      if (op.kind === 'image') {
        ctx.setTransform(...op.transform);
        if (op.clip) { path(op.clip); ctx.clip(); }
        if (op.replace) ctx.clearRect(0, 0, w, h);
        ctx.globalCompositeOperation = op.blend;
        ctx.drawImage(op.input === 'from' ? a : b, 0, 0);
      } else if (op.kind === 'tint') {
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = color(op.color); ctx.fillRect(0, 0, w, h);
      } else if (op.kind === 'fill') {
        ctx.fillStyle = color(op.color); path(op.path); ctx.fill();
      } else if (op.kind === 'stroke') {
        ctx.setTransform(...op.transform); path(op.path);
        ctx.strokeStyle = color(op.color); ctx.lineWidth = op.width; ctx.stroke();
      } else throw Error('Unsupported MV drawing command');
    } finally { ctx.restore(); }
  }
}
`;
