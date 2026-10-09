// Frozen recipe/post control flow from before cooperative iteration. Leaf
// raster operations remain shared; the separate Ember test freezes its replay.
export const PRE_ITERATOR_RECIPE_SOURCE = String.raw`
function renderMvRecipe(canvas, plan, assets) {
  if (!plan || plan.version !== 1) throw Error('MV recipe requires a matching Rust frame plan');
  const w = canvas.width, h = canvas.height;
  const css = c => 'rgba(' + c.slice(0,3).map(v => v * 255).join(',') + ',' + c[3] + ')';
  const release = c => { c.width = 1; c.height = 1; };
  function draw(node, role) {
    if (node.kind === 'ref') return draw(node.input, role);
    const out = new OffscreenCanvas(w, h), ctx = out.getContext('2d');
    try {
    if (node.kind === 'empty') return out;
    if (node.kind === 'panels') {
      for (const panel of node.panels) {
        let input;
        try {
          input = draw(panel.input, role);
          ctx.save(); ctx.beginPath();
          for (let i=0; i<panel.polygon.length; i++) {
            const p = panel.polygon[i]; if (i===0) ctx.moveTo(p[0],p[1]); else ctx.lineTo(p[0],p[1]);
          }
          ctx.closePath(); ctx.clip();
          // Each revealed panel replaces the region, including transparent
          // roles. Hero expansion cannot leave another shot's subject behind.
          ctx.clearRect(0,0,w,h);
          ctx.setTransform(...panel.transform); ctx.drawImage(input,0,0); ctx.restore();
          if (panel.border && panel.border.role === role) {
            ctx.strokeStyle = css(panel.border.color); ctx.lineWidth = panel.border.width * Math.min(w,h);
            if (ctx.lineWidth > 0 && panel.border.width > 0) ctx.stroke();
          }
        } finally { if (input) release(input); }
      }
    } else if (node.kind === 'imageSequence') {
      if (node.role === role) {
        const img = assets.sequenceImage(node.imageKey), c = node.view;
        const scale = Math.max(w / img.width, h / img.height) * c.zoom;
        const iw = img.width * scale, ih = img.height * scale;
        ctx.drawImage(img, (w - iw) * (1 + c.x) / 2, (h - ih) * (1 + c.y) / 2, iw, ih);
      }
    } else if (node.kind === 'afterimage') {
      if (node.role === role) drawMvAfterimage(ctx, node.data, assets, w, h);
    } else if (node.kind === 'typeCard') {
      if (node.role === role) drawMvTypeCard(ctx, node.data, assets, w, h);
    } else if (node.kind === 'converge') {
      if (node.role === role) drawMvConverge(ctx, node.data);
    } else if (node.kind === 'ember') {
      if (node.role === role) drawMvEmber(ctx, node.data, assets);
    } else if (node.kind === 'glyphRain') {
      if (node.role === role) drawMvGlyphRain(ctx, node.data, assets);
    } else if (node.kind === 'particleReveal') {
      if (node.role === role) drawMvParticleReveal(ctx, node.data, assets);
    } else if (node.kind === 'asciiSweep') {
      if (node.role === role) drawMvAsciiSweep(ctx, node.data, assets);
    } else if (node.kind === 'particleScroll') {
      if (node.role === role) drawMvParticleScroll(ctx, node.data, assets);
    } else if (node.kind === 'grid' || node.kind === 'hexFloat' || node.kind === 'shatter' || node.kind === 'cloth') {
      if (node.role === role) drawMvMeshImage(ctx, node.data, assets, w, h);
    } else if (node.kind === 'solid') {
      if (node.role === role) { ctx.fillStyle = css(node.color); ctx.fillRect(0, 0, w, h); }
    } else if (node.kind === 'illust') {
      if (node.background && role === 'background') {
        const {image, camera:c} = node.background, img = assets.image(image);
        const scale = Math.max(w / img.width, h / img.height) * c.zoom;
        const iw = img.width * scale, ih = img.height * scale;
        ctx.drawImage(img, (w - iw) * (1 + c.x) / 2, (h - ih) * (1 + c.y) / 2, iw, ih);
      }
      for (const s of node.sprites) {
        if (s.role !== role) continue;
        drawMvSprite(ctx, s, assets.image(s.image), w, h);
      }
    } else if (node.kind === 'transition') {
      let a, b;
      try {
        a = draw(node.from, role); b = draw(node.to, role);
        drawMvTransition(ctx, node.commands, a, b, role, w, h, node.style.kind);
      } finally { if (a) release(a); if (b) release(b); }
    } else throw Error('Unsupported MV scene');
    return out;
    } catch (error) { release(out); throw error; }
  }
  const output = canvas.getContext('2d');
  for (const role of plan.outputRoles) {
    const layer = draw(plan.root, role);
    try {
      const effects = plan.post.filter(p => (p.stage || 'role') === 'role' && p.roles.includes(role)).flatMap(p => p.effects);
      if (effects.length) applyMvPost(layer, effects);
      output.drawImage(layer, 0, 0);
    } finally { release(layer); }
  }
  // Only recipe-internal output roles are present here. External timeline
  // graphics (including native JIZURA lyrics) are not part of this surface.
  const compositeEffects = plan.post.filter(p => p.stage === 'composite').flatMap(p => p.effects);
  if (compositeEffects.length) applyMvPost(canvas, compositeEffects);
}
function applyMvPost(canvas, effects) {
  effects = effects.filter(item => item.effect.kind !== 'lightLeak' || item.effect.amount !== 0);
  const spatial = e => ['lineBoil','glitch','chromaticAberration','zoomBlur','bloom'].includes(e.effect.kind);
  for (let start = 0; start < effects.length;) {
    if (effects[start].effect.kind === 'lightLeak') { applyMvLightLeak(canvas,effects[start]); start++; continue; }
    const gpu = spatial(effects[start]);
    let end = start + 1;
    while (end < effects.length && effects[end].effect.kind !== 'lightLeak' && spatial(effects[end]) === gpu) end++;
    const group = effects.slice(start,end);
    if (gpu) applyMvSpatialPost(canvas,group); else applyMvColorPost(canvas,group);
    start = end;
  }
}
`;
