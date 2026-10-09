import { MV_SPATIAL_POST_SOURCE } from "./mv-spatial-post";
import { MV_LIGHT_LEAK_RENDERER_SOURCE } from "./mv-light-leak-renderer";

/** Adapted color formulas: vocaloid-style-mv-pipeline (MIT, NikusonP 2026).
 * Attribution and full license are in editor-classic/NOTICE.
 * Trusted Worker code. Color math operates on unpremultiplied sRGB from
 * getImageData and leaves alpha untouched, including fully transparent edges.
 * Spatial groups use premultiplied WebGL2; mixed chains keep authored order.
 */
export const MV_RECIPE_POST_SOURCE =
	MV_SPATIAL_POST_SOURCE +
	MV_LIGHT_LEAK_RENDERER_SOURCE +
	String.raw`
function* applyMvPostSteps(canvas, effects) {
  // A resolved zero leak is identity, including color-chain quantization.
  // Remove it before grouping so fractional adjacent grades stay one pass.
  effects = effects.filter(item => item.effect.kind !== 'lightLeak' || item.effect.amount !== 0);
  const spatial = e => ['lineBoil','glitch','chromaticAberration','zoomBlur','bloom'].includes(e.effect.kind);
  for (let start = 0; start < effects.length;) {
    if (effects[start].effect.kind === 'lightLeak') { applyMvLightLeak(canvas,effects[start]); start++; yield; continue; }
    const gpu = spatial(effects[start]);
    let end = start + 1;
    while (end < effects.length && effects[end].effect.kind !== 'lightLeak' && spatial(effects[end]) === gpu) end++;
    const group = effects.slice(start,end);
    if (gpu) applyMvSpatialPost(canvas,group); else applyMvColorPost(canvas,group);
    start = end;
    yield;
  }
}
function applyMvPost(canvas, effects) {
  for (const _ of applyMvPostSteps(canvas,effects)) {}
}
function applyMvColorPost(canvas, effects) {
  const ctx = canvas.getContext('2d', {willReadFrequently:true});
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height), d = image.data;
  const w = canvas.width, h = canvas.height;
  const clamp = x => Math.min(1, Math.max(0, x));
  const noise = (x, y, seed) => {
    let n = (Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ seed) >>> 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296 - 0.5;
  };
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    let c = [d[i] / 255, d[i + 1] / 255, d[i + 2] / 255];
    const x = (i / 4) % w, y = Math.floor(i / 4 / w);
    for (const {effect:e, seed} of effects) {
      if (e.kind === 'grade') {
        c = c.map(v => (v * Math.pow(2, e.exposure) - 0.5) * e.contrast + 0.5);
        const l = c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
        c = c.map((v, k) => e.lift[k] + (l + (v - l) * e.saturation) * (e.gain[k] - e.lift[k]));
      } else if (e.kind === 'palette') {
        const l = clamp(c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722) * (e.colors.length - 1);
        const a = Math.floor(l), b = Math.min(a + 1, e.colors.length - 1), p = l - a;
        c = c.map((v, k) => v * (1 - e.mix) + (e.colors[a][k] + (e.colors[b][k] - e.colors[a][k]) * p) * e.mix);
      } else if (e.kind === 'vignette') {
        const r = Math.hypot(((x + 0.5) / w - 0.5) * w / h, (y + 0.5) / h - 0.5);
        const t = clamp((r - 0.35) / 0.7), m = 1 - e.amount * t * t * (3 - 2 * t);
        c = c.map(v => v * m);
      } else if (e.kind === 'grain') {
        const n = noise(x, y, seed) * e.amount * (0.6 + 0.4 * (1 - (c[0] + c[1] + c[2]) / 3));
        c = c.map(v => v + n);
      } else if (e.kind === 'letterbox') {
        const edge = e.amount * e.heightFraction, py = (y + 0.5) / h;
        if (py < edge || py > 1 - edge) c = [0,0,0];
      } else if (e.kind === 'quantizationDither') {
        // The plan supplies the static source seed, not a time-sampled grain seed.
        // Retain fractional color until the shared final rounding below.
        const n = noise(x + 5113, y + 7919, seed) * e.amount / 255;
        c = c.map(v => v + n);
      } else throw Error('Unsupported MV post effect');
    }
    d[i] = Math.round(clamp(c[0]) * 255); d[i + 1] = Math.round(clamp(c[1]) * 255); d[i + 2] = Math.round(clamp(c[2]) * 255);
  }
  ctx.putImageData(image, 0, 0);
}
`;
