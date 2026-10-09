/** Raster adapter only. Rust supplies every circle, stop, alpha and time sample.
 * Expand follows the reference seq overlay's two ordered Canvas screen draws.
 * Preserve screens straight RGB on opaque coverage then restores input alpha.
 */
export const MV_LIGHT_LEAK_RENDERER_SOURCE = String.raw`
function applyMvLightLeak(canvas, item) {
  if (!item.lightLeak) throw Error('Missing Rust light-leak plan');
  if (item.effect.amount === 0) return;
  const ctx = canvas.getContext('2d', {willReadFrequently:true});
  let coverage = null;
  if (item.effect.alpha === 'preserve') {
    const image = ctx.getImageData(0,0,canvas.width,canvas.height), d = image.data;
    coverage = new Uint8Array(canvas.width * canvas.height);
    for (let i=0; i<coverage.length; i++) { coverage[i] = d[i*4+3]; d[i*4+3] = 255; }
    ctx.putImageData(image,0,0);
  }
  ctx.save();
  try {
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'screen';
    for (const gradient of item.lightLeak.gradients) {
      const [x,y] = gradient.center;
      const paint = ctx.createRadialGradient(x,y,0,x,y,gradient.radius);
      for (const stop of gradient.stops) paint.addColorStop(stop.offset,'rgba(' + stop.color.join(',') + ')');
      ctx.fillStyle = paint; ctx.fillRect(0,0,canvas.width,canvas.height);
    }
  } finally { ctx.restore(); }
  if (coverage) {
    const image = ctx.getImageData(0,0,canvas.width,canvas.height);
    for (let i=0; i<coverage.length; i++) image.data[i*4+3] = coverage[i];
    ctx.putImageData(image,0,0);
  }
}
`;
