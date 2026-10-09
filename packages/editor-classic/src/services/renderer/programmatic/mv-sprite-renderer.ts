/** Executes Rust's sampled pose/slices, with no independent animation clock. */
export const MV_SPRITE_RENDERER_SOURCE = String.raw`
function drawMvSprite(ctx, s, img, w, h, createSurface) {
  const p = s.pose;
  if (p.opacity <= 0) return;
  const sh = p.height * h, sw = sh * img.width / img.height;
  const css = c => 'rgba(' + c.slice(0,3).map(v => v * 255).join(',') + ',' + c[3] + ')';
  const release = c => { c.width = 1; c.height = 1; };
  const make = (width,height) => createSurface ? createSurface(width,height) : new OffscreenCanvas(width,height);
  function paint(target, offset = [0,0]) {
    target.save();
    try {
    target.translate((p.x + offset[0]) * w, (p.y + offset[1]) * h);
    target.rotate(p.rotation); target.scale(s.flip ? -1 : 1, 1);
    const x = -s.anchor[0] * sw, y = -s.anchor[1] * sh;
    if (s.slices) {
      // Non-overlapping strips: overdraw would make translucent assets opaque
      // at slice boundaries. Add coverage on an EMPTY mask so rotated shared
      // anti-aliased edges sum to the original alpha, not source-over dark seams.
      target.globalCompositeOperation = 'lighter';
      for (const slice of s.slices) {
        const height = slice.end - slice.start;
        const dx = x + slice.offset * sh;
        // Sample the full image through a strip clip, not a cropped image with
        // its own filtered edge (which would multiply the edge coverage twice).
        target.save();
        try {
          target.beginPath();
          target.rect(dx, y + slice.start * sh, sw, height * sh); target.clip();
          target.drawImage(img, dx, y, sw, sh);
        } finally { target.restore(); }
      }
    } else target.drawImage(img, x, y, sw, sh);
    } finally { target.restore(); }
  }
  if (!s.slices && !s.shadow && !s.rim && !s.silhouette && !s.glow) {
    ctx.save();
    try { ctx.globalAlpha *= p.opacity; paint(ctx); } finally { ctx.restore(); }
    return;
  }
  const pad = Math.ceil(3 * Math.max(s.shadow?.blur || 0, s.rim?.blur || 0) * Math.min(w,h));
  let group, mask;
  try {
    group = make(w,h); mask = make(w+2*pad,h+2*pad);
    const g = group.getContext('2d'), m = mask.getContext('2d');
    function masked(color, offset) {
      m.clearRect(0,0,mask.width,mask.height);
      m.save();
      try { m.translate(pad,pad); paint(m, offset); } finally { m.restore(); }
      if (color) {
        m.save();
        try {
          m.globalCompositeOperation = 'source-in'; m.fillStyle = css(color);
          m.fillRect(0,0,mask.width,mask.height);
        } finally { m.restore(); }
      }
    }
    for (const [effect, additive] of [[s.shadow, false], [s.rim, true]]) {
      if (!effect) continue;
      // Paint at the actual offset, rather than shifting a frame-clipped mask:
      // offscreen bodies can still cast an onscreen silhouette.
      masked(effect.color, effect.offset);
      g.save();
      try {
        g.globalCompositeOperation = additive ? 'lighter' : 'source-over';
        if (effect.blur > 0) g.filter = 'blur(' + (effect.blur * Math.min(w,h)) + 'px)';
        g.drawImage(mask,-pad,-pad);
      } finally { g.restore(); }
    }
    masked(s.silhouette, [0,0]); g.drawImage(mask,-pad,-pad);
    if (s.glow) {
      const e = s.glow, x = p.x*w + e.offset[0]*sh, y = p.y*h + e.offset[1]*sh, r = e.radius*sh;
      const gradient = g.createRadialGradient(x,y,0,x,y,r);
      gradient.addColorStop(0,css(e.color));
      gradient.addColorStop(0.25,css([...e.color.slice(0,3),e.color[3]*0.45]));
      gradient.addColorStop(1,css([...e.color.slice(0,3),0]));
      g.save();
      try { g.globalCompositeOperation = 'lighter'; g.fillStyle = gradient; g.fillRect(x-r,y-r,r*2,r*2); }
      finally { g.restore(); }
    }
    // Fade the assembled sprite once, including its shadow/rim/glow.
    ctx.save();
    try { ctx.globalAlpha *= p.opacity; ctx.drawImage(group,0,0); } finally { ctx.restore(); }
  } finally { if (mask) release(mask); if (group) release(group); }
}
`;
