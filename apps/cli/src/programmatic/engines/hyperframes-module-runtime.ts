/** Fixed browser resolver. Resource bytes and executable modules stay separate. */
export const HYPERFRAMES_MODULE_RUNTIME_SOURCE = String.raw`
function hfCreateModuleRuntime(maps,bodies,assets) {
  const string = value => {
    if (typeof value === 'symbol') throw TypeError('Cannot convert a Symbol to a URL');
    return typeof value === 'string' ? value : String(value);
  };
  const metaUrl = url => {
    const hash = new URL(url).hash;
    if (!hash.startsWith('#rocut=')) throw Error('Missing archived module identity');
    return decodeURIComponent(hash.slice(7));
  };
  const moduleUrl = url => bodies[hfModuleFile(url)]+'#rocut='+encodeURIComponent(url);
  const fromData = (value,moduleOnly) => {
    // A module URI must have both a declared source identity and exact compiled
    // bytes. Returning an image/font/media URI never grants it execution rights.
    if (new URL(value).hash.startsWith('#rocut=')) {
      const url = metaUrl(value), id = hfModuleFile(url);
      if (Object.hasOwn(bodies,id) && value === moduleUrl(url)) return value;
    }
    if (!moduleOnly) {
      const body = value.split('#',1)[0];
      if (Object.values(assets).includes(body)) return value;
    }
    throw Error('Data URL is not in the declared '+(moduleOnly ? 'module' : 'resource')+' graph');
  };
  const resolve = (specifier,base,moduleOnly,mapped) => {
    const value = string(specifier);
    if (value.startsWith('data:')) return fromData(value,moduleOnly);
    const url = value.startsWith(HF_MODULE_ROOT) ? value
      : mapped ? hfModuleResolve(value,base,maps) : hfModuleAddress(value,base);
    const id = hfModuleFile(url);
    if (Object.hasOwn(bodies,id)) return moduleUrl(url);
    if (!moduleOnly && Object.hasOwn(assets,id)) return assets[id]+new URL(url).hash;
    throw Error('Undeclared '+(moduleOnly ? 'module' : 'resource')+' dependency');
  };
  const resolveUrl = (specifier,base) => resolve(specifier,base,false,true);
  const loadUrl = (specifier,base) => resolve(specifier,base,true,true);
  const resourceArguments = (input,base) => {
    // Native constructor IDL string conversion is input then base. Preserve it
    // without reevaluating the author's two argument expressions or replacing
    // the URL constructor, its prototype, static functions or global binding.
    const value = string(input), origin = string(base);
    if (!origin.startsWith(HF_MODULE_ROOT)) throw Error('URL base is outside the declared project');
    hfModuleFile(origin);
    return [resolve(value,origin,false,false)];
  };
  return Object.freeze({metaUrl,resolveUrl,loadUrl,resourceArguments});
}
`;

/** MIME selection is compiler IO, not a new author execution path. */
export const HYPERFRAMES_RESOURCE_MIMES = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".avif": "image/avif",
	".svg": "image/svg+xml",
	".bmp": "image/bmp",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".otf": "font/otf",
	".mp4": "video/mp4",
	".webm": "video/webm",
	".wav": "audio/wav",
	".mp3": "audio/mpeg",
	".ogg": "audio/ogg",
	".flac": "audio/flac",
	".aac": "audio/aac",
	".m4a": "audio/mp4",
	".txt": "text/plain",
	".html": "text/html",
	".htm": "text/html",
	".css": "text/css",
	".xml": "application/xml",
} as const;
