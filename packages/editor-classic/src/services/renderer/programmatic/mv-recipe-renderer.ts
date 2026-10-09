import { MV_RECIPE_POST_SOURCE } from "./mv-recipe-post";
import { MV_TRANSITION_RENDERER_SOURCE } from "./mv-transition-renderer";
import { MV_SPRITE_RENDERER_SOURCE } from "./mv-sprite-renderer";
import { MV_GENERATOR_RENDERER_SOURCE } from "./mv-generator-renderer";
import { MV_ASCII_SWEEP_RENDERER_SOURCE } from "./mv-ascii-sweep-renderer";
import { MV_PARTICLE_SCROLL_RENDERER_SOURCE } from "./mv-particle-scroll-renderer";
import { MV_MESH_RENDERER_SOURCE } from "./mv-mesh-renderer";
import { MV_AFTERIMAGE_RENDERER_SOURCE } from "./mv-afterimage-renderer";
import { MV_TYPE_CARD_RENDERER_SOURCE } from "./mv-type-card-renderer";
import { MV_CONVERGE_RENDERER_SOURCE } from "./mv-converge-renderer";
import { MV_EMBER_RENDERER_SOURCE } from "./mv-ember-renderer";

/** Built-in drawing only: the source recipe never becomes executable text.
 * Timing/easing/oscillation/role order are evaluated by Rust before this seam.
 * createSurface is a trusted 2D allocator, never authored plan data. GPU helpers
 * retain genuine OffscreenCanvas WebGL contexts. Consumers must return/throw
 * on cancellation; a single fixed node helper or post group is not preemptible.
 */
export const MV_RECIPE_RENDERER_SOURCE =
	MV_RECIPE_POST_SOURCE +
	MV_MESH_RENDERER_SOURCE +
	MV_TRANSITION_RENDERER_SOURCE +
	MV_SPRITE_RENDERER_SOURCE +
	MV_GENERATOR_RENDERER_SOURCE +
	MV_ASCII_SWEEP_RENDERER_SOURCE +
	MV_PARTICLE_SCROLL_RENDERER_SOURCE +
	MV_AFTERIMAGE_RENDERER_SOURCE +
	MV_TYPE_CARD_RENDERER_SOURCE +
	MV_CONVERGE_RENDERER_SOURCE +
	MV_EMBER_RENDERER_SOURCE +
	String.raw`
function* renderMvRecipeSteps(canvas, plan, assets, createSurface) {
  if (!plan || plan.version !== 1) throw Error('MV recipe requires a matching Rust frame plan');
  const w = canvas.width, h = canvas.height;
  const css = c => 'rgba(' + c.slice(0,3).map(v => v * 255).join(',') + ',' + c[3] + ')';
  const release = c => { c.width = 1; c.height = 1; };
  const make = (width,height) => createSurface ? createSurface(width,height) : new OffscreenCanvas(width,height);
  function* draw(node, role) {
    if (node.kind === 'ref') return yield* draw(node.input, role);
    const out = make(w,h);
    let transferred = false;
    try {
      const ctx = out.getContext('2d');
      if (node.kind === 'empty') {
        // Empty nodes still form a cancellation boundary before ownership transfer.
      } else if (node.kind === 'panels') {
        for (const panel of node.panels) {
          let input;
          try {
            input = yield* draw(panel.input, role);
            ctx.save();
            try {
              ctx.beginPath();
              for (let i=0; i<panel.polygon.length; i++) {
                const p = panel.polygon[i]; if (i===0) ctx.moveTo(p[0],p[1]); else ctx.lineTo(p[0],p[1]);
              }
              ctx.closePath(); ctx.clip();
              // Replacement includes transparent roles; no previous subject leaks.
              ctx.clearRect(0,0,w,h);
              ctx.setTransform(...panel.transform); ctx.drawImage(input,0,0);
            } finally { ctx.restore(); }
            if (panel.border && panel.border.role === role) {
              ctx.strokeStyle = css(panel.border.color); ctx.lineWidth = panel.border.width * Math.min(w,h);
              if (ctx.lineWidth > 0 && panel.border.width > 0) ctx.stroke();
            }
          } finally { if (input) release(input); }
          yield;
        }
      } else if (node.kind === 'imageSequence') {
        if (node.role === role) {
          const img = assets.sequenceImage(node.imageKey), c = node.view;
          const scale = Math.max(w / img.width, h / img.height) * c.zoom;
          const iw = img.width * scale, ih = img.height * scale;
          ctx.drawImage(img, (w - iw) * (1 + c.x) / 2, (h - ih) * (1 + c.y) / 2, iw, ih);
        }
      } else if (node.kind === 'afterimage') {
        if (node.role === role) drawMvAfterimage(ctx, node.data, assets, w, h, createSurface);
      } else if (node.kind === 'typeCard') {
        if (node.role === role) drawMvTypeCard(ctx, node.data, assets, w, h, createSurface);
      } else if (node.kind === 'converge') {
        if (node.role === role) drawMvConverge(ctx, node.data, createSurface);
      } else if (node.kind === 'ember' || node.kind === 'titleRiff' || node.kind === 'kanjiSlam' || node.kind === 'thread') {
        if (node.role === role) yield* drawMvEmberSteps(ctx, node.data, assets, createSurface);
      } else if (node.kind === 'glyphRain') {
        if (node.role === role) drawMvGlyphRain(ctx, node.data, assets);
      } else if (node.kind === 'particleReveal') {
        if (node.role === role) drawMvParticleReveal(ctx, node.data, assets);
      } else if (node.kind === 'asciiSweep') {
        if (node.role === role) drawMvAsciiSweep(ctx, node.data, assets);
      } else if (node.kind === 'particleScroll') {
        if (node.role === role) drawMvParticleScroll(ctx, node.data, assets);
      } else if (node.kind === 'grid' || node.kind === 'hexFloat' || node.kind === 'shatter' || node.kind === 'cloth') {
        if (node.role === role) drawMvMeshImage(ctx, node.data, assets, w, h, createSurface);
      } else if (node.kind === 'solid') {
        if (node.role === role) { ctx.fillStyle = css(node.color); ctx.fillRect(0, 0, w, h); }
      } else if (node.kind === 'illust') {
        if (node.background && role === 'background') {
          const {image, camera:c} = node.background, img = assets.image(image);
          const scale = Math.max(w / img.width, h / img.height) * c.zoom;
          const iw = img.width * scale, ih = img.height * scale;
          ctx.drawImage(img, (w - iw) * (1 + c.x) / 2, (h - ih) * (1 + c.y) / 2, iw, ih);
          yield;
        }
        for (const s of node.sprites) {
          if (s.role !== role) continue;
          drawMvSprite(ctx, s, assets.image(s.image), w, h, createSurface);
          yield;
        }
      } else if (node.kind === 'transition') {
        let a, b;
        try {
          a = yield* draw(node.from, role); b = yield* draw(node.to, role);
          drawMvTransition(ctx, node.commands, a, b, role, w, h, node.style.kind);
        } finally { if (a) release(a); if (b) release(b); }
      } else throw Error('Unsupported MV scene');
      yield;
      transferred = true;
      return out;
    } finally { if (!transferred) release(out); }
  }
  const output = canvas.getContext('2d');
  for (const role of plan.outputRoles) {
    let layer;
    try {
      layer = yield* draw(plan.root, role);
      const effects = plan.post.filter(p => (p.stage || 'role') === 'role' && p.roles.includes(role)).flatMap(p => p.effects);
      if (effects.length) yield* applyMvPostSteps(layer, effects);
      output.drawImage(layer, 0, 0);
      yield;
    } finally { if (layer) release(layer); }
  }
  // This surface contains recipe roles only, not external timeline/JIZURA layers.
  const compositeEffects = plan.post.filter(p => p.stage === 'composite').flatMap(p => p.effects);
  if (compositeEffects.length) yield* applyMvPostSteps(canvas, compositeEffects);
}
function renderMvRecipe(canvas, plan, assets, createSurface) {
  for (const _ of renderMvRecipeSteps(canvas,plan,assets,createSurface)) {}
}
`;
