/** Shared font loading keeps measurement and rasterization on identical bytes,
 * face descriptors and static variation axes inside a fresh isolated Worker.
 */
export const FONT_METRICS_WORKER_SOURCE = String.raw`
async function loadProgrammaticFont(resource, body) {
  if (!(body instanceof ArrayBuffer) || body.byteLength !== resource.byteLength)
    throw Error('Font attachment length mismatch');
  // Parent verified this owned byte snapshot before the opaque-origin transfer.
  const f = resource.font;
  if (!f) throw Error('Missing declared font descriptor');
  const axes = Object.entries(f.axes || {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const face = new FontFace(f.family, body, {
    style: f.style, weight: String(f.weight),
    ...(axes.length ? {variationSettings: axes.map(([tag, value]) => JSON.stringify(tag) + ' ' + value).join(', ')} : {})
  });
  await face.load(); self.fonts.add(face);
}
function fontMetricRecord(value, keys) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every(key => keys.includes(key));
}
function sameFontMetricIdentity(a, b) {
  const fields = ['id', 'kind', 'attachmentKey', 'mimeType', 'byteLength', 'sha256'];
  if (!fontMetricRecord(a, [...fields, 'font']) || !b || b.kind !== 'font'
    || fields.some(key => a[key] !== b[key])) return false;
  const f = a.font, g = b.font;
  if (!fontMetricRecord(f, ['family', 'style', 'weight', 'axes']) || !g
    || ['family', 'style', 'weight'].some(key => f[key] !== g[key])) return false;
  if (f.axes !== undefined && !fontMetricRecord(f.axes, Object.keys(f.axes || {}))) return false;
  const aa = Object.entries(f.axes || {}).sort(), bb = Object.entries(g.axes || {}).sort();
  return aa.length === bb.length && aa.every(([tag, value], i) =>
    tag === bb[i][0] && Number.isFinite(value) && value === bb[i][1]);
}
function fontMetricScalars(text) {
  if (typeof text !== 'string') throw Error('Font metrics require Unicode strings');
  const chars = [...text];
  if (chars.some(ch => ch.length === 1 && ch.charCodeAt(0) >= 0xd800 && ch.charCodeAt(0) <= 0xdfff))
    throw Error('Font metrics require complete Unicode scalars');
  return chars.length;
}
function validateFontMetricRequests(requests, descriptors) {
  if (!Array.isArray(requests) || requests.length > 64) throw Error('Font metric font budget exceeded');
  let glyphCount = 0, advanceCount = 0, scalarCount = 0, boundCount = 0, boundScalars = 0;
  const fonts = new Set();
  for (const request of requests) {
    if (!fontMetricRecord(request, ['resource', 'glyphs', 'advances', 'bounds'])) throw Error('Invalid font metric request');
    const resource = descriptors.get(request.resource?.id);
    if (!sameFontMetricIdentity(request.resource, resource))
      throw Error('Font measurement requires an identical declared loaded font');
    if (fonts.has(resource.id)) throw Error('Duplicate requested font');
    fonts.add(resource.id);
    const advances = request.advances === undefined ? [] : request.advances;
    const bounds = request.bounds === undefined ? [] : request.bounds;
    if (!Array.isArray(request.glyphs) || !Array.isArray(advances) || !Array.isArray(bounds)
      || request.glyphs.length + advances.length + bounds.length === 0) throw Error('Invalid font metric sets');
    glyphCount += request.glyphs.length; advanceCount += advances.length;
    if (glyphCount > 1024 || advanceCount > 1024) throw Error('Font metric global item budget exceeded');
    const glyphs = new Set(), keys = new Set();
    for (const text of request.glyphs) {
      if (fontMetricScalars(text) !== 1 || glyphs.has(text)) throw Error('Invalid or duplicate metric glyph');
      glyphs.add(text);
    }
    for (const a of advances) {
      if (!fontMetricRecord(a, ['text', 'fontSizePx', 'letterSpacingPx'])) throw Error('Invalid font advance request');
      const length = fontMetricScalars(a.text);
      scalarCount += length;
      if (length > 1024 || scalarCount > 65536) throw Error('Font advance global text budget exceeded');
      if (!Number.isFinite(a.fontSizePx) || a.fontSizePx <= 0 || a.fontSizePx > 4096
        || !Number.isFinite(a.letterSpacingPx) || Math.abs(a.letterSpacingPx) > 4096)
        throw Error('Invalid font advance size or tracking');
      const key = JSON.stringify([a.text, a.fontSizePx, a.letterSpacingPx]);
      if (keys.has(key)) throw Error('Duplicate requested font advance');
      keys.add(key);
    }
    boundCount += bounds.length;
    if (boundCount > 1024) throw Error('Font bounds global item budget exceeded');
    const boundKeys = new Set();
    for (const b of bounds) {
      if (!fontMetricRecord(b, ['version', 'text', 'fontSizePx', 'letterSpacingPx', 'align', 'baseline'])
        || b.version !== 1 || !['left', 'center', 'right'].includes(b.align)
        || !['top', 'hanging', 'middle', 'alphabetic', 'ideographic', 'bottom'].includes(b.baseline))
        throw Error('Invalid font bounds request');
      const length = fontMetricScalars(b.text);
      boundScalars += length;
      if (length > 1024 || boundScalars > 65536) throw Error('Font bounds global text budget exceeded');
      if (!Number.isFinite(b.fontSizePx) || b.fontSizePx <= 0 || b.fontSizePx > 4096
        || !Number.isFinite(b.letterSpacingPx) || Math.abs(b.letterSpacingPx) > 4096)
        throw Error('Invalid font bounds size or tracking');
      const key = JSON.stringify([b.version, b.text, b.fontSizePx, b.letterSpacingPx, b.align, b.baseline]);
      if (boundKeys.has(key)) throw Error('Duplicate requested font bounds');
      boundKeys.add(key);
    }
  }
}
function measureProgrammaticFonts(requests, descriptors) {
  validateFontMetricRequests(requests, descriptors);
  const canvas = new OffscreenCanvas(1, 1), ctx = canvas.getContext('2d');
  if (!ctx) throw Error('Font measurement requires Canvas2D');
  const supportsTracking = 'letterSpacing' in ctx;
  try {
    return requests.map(request => {
      const resource = descriptors.get(request.resource.id);
      if (!resource || resource.kind !== 'font' || !resource.font)
        throw Error('Font measurement requires a declared loaded font');
      const f = resource.font;
      ctx.font = f.style + ' ' + f.weight + ' 100px ' + JSON.stringify(f.family);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.letterSpacing = '0px';
      ctx.direction = 'ltr'; ctx.fontKerning = 'auto'; ctx.wordSpacing = '0px';
      ctx.fontStretch = 'normal'; ctx.fontVariantCaps = 'normal'; ctx.textRendering = 'auto';
      // No fonts.ready: explicit FontFace.load is the barrier in a Worker.
      const glyphs = request.glyphs.map(text => {
        const m = ctx.measureText(text);
        return {text, left: m.actualBoundingBoxLeft, right: m.actualBoundingBoxRight,
          ascent: m.actualBoundingBoxAscent, descent: m.actualBoundingBoxDescent};
      });
      const advances = (request.advances || []).map(a => {
        if (a.letterSpacingPx !== 0 && !supportsTracking)
          throw Error('Canvas does not support declared font tracking');
        ctx.font = f.style + ' ' + f.weight + ' ' + a.fontSizePx + 'px ' + JSON.stringify(f.family);
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.letterSpacing = a.letterSpacingPx + 'px';
        const width = ctx.measureText(a.text).width;
        if (!Number.isFinite(width) || Math.abs(width) > 16777216 || (a.text === '' && width !== 0))
          throw Error('Invalid measured font advance');
        return {text: a.text, fontSizePx: a.fontSizePx, letterSpacingPx: a.letterSpacingPx, width};
      });
      const bounds = (request.bounds || []).map(b => {
        if (b.letterSpacingPx !== 0 && !supportsTracking)
          throw Error('Canvas does not support declared font tracking');
        ctx.font = f.style + ' ' + f.weight + ' ' + b.fontSizePx + 'px ' + JSON.stringify(f.family);
        ctx.textAlign = b.align; ctx.textBaseline = b.baseline;
        ctx.letterSpacing = b.letterSpacingPx + 'px';
        if (ctx.textAlign !== b.align || ctx.textBaseline !== b.baseline)
          throw Error('Canvas does not support declared font bounds context');
        const m = ctx.measureText(b.text);
        const left = m.actualBoundingBoxLeft, right = m.actualBoundingBoxRight;
        const ascent = m.actualBoundingBoxAscent, descent = m.actualBoundingBoxDescent;
        const values = [left, right, ascent, descent];
        // Empty text has no ink, but real fonts can offset the native baseline
        // with equal/opposite ascent/descent. Preserve those measured facts.
        if (values.some(v => !Number.isFinite(v) || Math.abs(v) > 16777216)
          || left + right < 0 || ascent + descent < 0
          || (b.text === '' && (left + right !== 0 || ascent + descent !== 0)))
          throw Error('Invalid measured font bounds: ' + JSON.stringify({
            font: resource.id, text: b.text.slice(0, 64), size: b.fontSizePx,
            tracking: b.letterSpacingPx, align: b.align, baseline: b.baseline, values
          }));
        return {version: b.version, text: b.text, fontSizePx: b.fontSizePx,
          letterSpacingPx: b.letterSpacingPx === 0 ? 0 : b.letterSpacingPx,
          align: b.align, baseline: b.baseline, left, right, ascent, descent};
      });
      return {resource, glyphs, ...(advances.length ? {advances} : {}), ...(bounds.length ? {bounds} : {})};
    });
  } finally { canvas.width = 1; canvas.height = 1; }
}
`;
