/** Fixed raster seam: timing, role policy and graph admission are Rust-owned. */
export const MV_LAYERS_RENDERER_SOURCE = String.raw`
function* mvLayersDraw(ctx, node, role, draw, release, check) {
  for (const item of node.items) {
    if (!item.roles.includes(role)) continue;
    check();
    let child;
    try {
      child = yield* draw(item.input, role);
      check();
      ctx.save();
      try {
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
        ctx.filter = 'none'; ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
        ctx.drawImage(child, 0, 0);
      } finally { ctx.restore(); }
    } finally { if (child) release(child); }
    yield;
  }
}
`;
