/** Dedicated platform bridge. All role, cmap, axis and alias decisions arrive
 * from Rust; this code only snapshots/loads bytes and performs native Canvas.
 * The host must run verifyProgrammaticFontResources before the private port;
 * native packed-byte admission independently rechecks SHA/SFNT. Opaque-origin
 * Workers have no WebCrypto: no worker-side digest or fallback is attempted.
 * It must be installed in the isolated owned-font sandbox, never a host page.
 * Public sandbox and renderer registration remain separate integration gates.
 */
export const MV_TUNNEL_FONT_STACK_SOURCE = String.raw`
async function mvTunnelFontStacks(assets, fontSet) {
  const loaded = new Map();
  const stacks = new Map();
  const canonical = value => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    return value;
  };
  const identity = value => JSON.stringify(canonical(value));
  const snapshot = value => JSON.parse(JSON.stringify(value));
  async function load(stack) {
    const bound = snapshot(stack);
    const key = identity(bound);
    if (stacks.has(key)) return stacks.get(key);
    if (!Array.isArray(bound.resources) || bound.resources.length !== 2 || !Array.isArray(bound.aliases) || bound.aliases.length !== 2)
      throw Error('Tunnel requires a Rust-admitted ordered two-face stack');
    for (let i = 0; i < 2; i++) {
      const resource = bound.resources[i], alias = bound.aliases[i];
      if (resource.kind !== 'font' || !resource.font || typeof alias !== 'string' || !/^mv-tunnel-[a-f0-9]{64}-(400|800|900)$/.test(alias))
        throw Error('Tunnel requires admitted declared font aliases');
      if (identity(assets.descriptor(resource.id)) !== identity(resource)) throw Error('Tunnel font descriptor changed');
      if (loaded.has(alias)) {
        if (loaded.get(alias).identity !== identity(resource)) throw Error('Tunnel font alias identity collision');
        continue;
      }
      const source = assets.bytes(resource.id);
      if (!(source instanceof ArrayBuffer)) throw Error('Tunnel font snapshot must be ArrayBuffer');
      const bytes = source.slice(0);
      if (bytes.byteLength !== resource.byteLength) throw Error('Tunnel font length mismatch');
      const font = resource.font;
      const settings = Object.entries(font.axes || {}).map(([tag,value]) => JSON.stringify(tag) + ' ' + value).join(',') || 'normal';
      const face = new FontFace(alias, bytes, {style:font.style, weight:String(font.weight), variationSettings:settings});
      await face.load();
      if (face.status !== 'loaded') throw Error('Tunnel FontFace did not load');
      fontSet.add(face);
      loaded.set(alias,{identity:identity(resource),face});
    }
    stacks.set(key,bound);
    return bound;
  }
  function font(ctx, stack, size, tracking, align, baseline, text) {
    const bound = stacks.get(identity(stack));
    if (!bound) throw Error('Tunnel text stack was not loaded');
    for (const scalar of text) {
      if (!Object.prototype.hasOwnProperty.call(bound.routes,scalar) || !bound.resources.some(r => r.id === bound.routes[scalar]))
        throw Error('Tunnel text is outside Rust-admitted coverage');
    }
    if (!Number.isFinite(size) || size <= 0 || !Number.isFinite(tracking)) throw Error('Tunnel invalid text size/tracking');
    if (tracking !== 0 && !('letterSpacing' in ctx)) throw Error('Canvas lacks Tunnel tracking');
    const descriptor = bound.resources[0].font;
    ctx.font = descriptor.style + ' ' + descriptor.weight + ' ' + size + 'px ' + bound.aliases.map(alias => JSON.stringify(alias)).join(', ');
    ctx.letterSpacing = tracking + 'px'; ctx.textAlign = align; ctx.textBaseline = baseline;
    ctx.direction = 'ltr'; ctx.fontKerning = 'auto'; ctx.wordSpacing = '0px';
    ctx.fontStretch = 'normal'; ctx.fontVariantCaps = 'normal'; ctx.textRendering = 'auto';
    return bound;
  }
  return {
    load,
    async measure(ctx, request) {
      if (request.fontSize !== 100) throw Error('Tunnel metrics require exact 100px');
      const bound = await load(request.fontStack);
      if (request.characters.length !== Object.keys(bound.routes).length || new Set(request.characters).size !== request.characters.length)
        throw Error('Tunnel incomplete metric request');
      const advances = Object.create(null);
      ctx.save();
      try {
        ctx.setTransform(1,0,0,1,0,0); ctx.filter='none'; ctx.globalAlpha=1; ctx.globalCompositeOperation='source-over';
        for (const scalar of request.characters) {
          if ([...scalar].length !== 1) throw Error('Tunnel metric key must be one scalar');
          font(ctx,bound,100,0,'left','alphabetic',scalar);
          const width = ctx.measureText(scalar).width;
          if (!Number.isFinite(width) || width < 0 || width > 4096) throw Error('Tunnel invalid native advance');
          advances[scalar] = width;
        }
      } finally { ctx.restore(); }
      return {nodeId:request.nodeId,fontStack:snapshot(bound),fontSize:100,advances};
    },
    draw(ctx, command) {
      if (command.kind !== 'stackText') throw Error('Tunnel bridge only executes stackText');
      font(ctx,command.fontStack,command.fontSize,command.tracking,command.align,command.baseline,command.text);
      ctx.fillStyle = command.style ? mvEmberStyle(ctx,command.style) : mvEmberCss(command.color);
      ctx.globalAlpha=command.opacity; ctx.globalCompositeOperation=command.composite;
      ctx.fillText(command.text,...command.position);
    },
    dispose() {
      for (const {face} of loaded.values()) fontSet.delete(face);
      loaded.clear(); stacks.clear();
    },
  };
}
`;
