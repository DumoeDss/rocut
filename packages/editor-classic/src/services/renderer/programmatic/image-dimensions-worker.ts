/** Browser mechanisms only: limits/requests are supplied by Rust; dimensions
 * are actual decode results. No cover geometry, scene policy or timing here. */
export const IMAGE_DIMENSIONS_WORKER_SOURCE = String.raw`
function sameMvImageIdentity(a, b) {
  const fields = ['id','kind','attachmentKey','mimeType','byteLength','sha256'];
  return !!a && !!b && typeof a === 'object' && typeof b === 'object'
    && !Array.isArray(a) && !Array.isArray(b) && a.kind === 'image' && b.kind === 'image'
    && Object.keys(a).length === fields.length && Object.keys(b).length === fields.length
    && fields.every(key => a[key] === b[key]);
}
function createMvImageDecodeBudget(limits) {
  let bytes = 0;
  return { reserve(width, height) {
    if (!limits || !Number.isSafeInteger(limits.maxDimension) || limits.maxDimension <= 0 || !Number.isSafeInteger(limits.maxDecodedBytes) || limits.maxDecodedBytes <= 0) throw Error('Missing image decode limits');
    if (![width,height].every(v => Number.isSafeInteger(v) && v > 0 && v <= limits.maxDimension)) throw Error('Invalid image geometry');
    bytes += width * height * 4;
    if (!Number.isSafeInteger(bytes) || bytes > limits.maxDecodedBytes) throw Error('Combined image decode budget exceeded');
  }};
}
async function decodeMvDeclaredImages(frame, resources, admissions, operation, budget) {
  const requests = frame.imageDimensionRequests || [];
  const expected = operation === 'render' ? resources.filter(r => r.resource.kind === 'image')
    : requests.map(request => {
      const found = resources.filter(r => sameMvImageIdentity(r.resource, request.resource));
      if (found.length !== 1 || request.resource.kind !== 'image') throw Error('Missing requested image');
      return found[0];
    });
  const images = new Map(), owned = new Set(), facts = [];
  const close = () => { for (const bitmap of owned) bitmap.close(); owned.clear(); images.clear(); };
  try {
    if (!Array.isArray(admissions) || admissions.length !== expected.length) throw Error('Missing encoded image admission');
    const seen = new Set();
    for (const item of expected) {
      const matching = admissions.filter(a => sameMvImageIdentity(a.resource, item.resource));
      if (matching.length !== 1 || seen.has(item.resource.id) || !(item.body instanceof ArrayBuffer) || item.body.byteLength !== item.resource.byteLength) throw Error('Image admission identity mismatch');
      seen.add(item.resource.id);
      const admitted = matching[0];
      if (admitted.decodedBytes !== admitted.width * admitted.height * 4) throw Error('Invalid encoded image allocation');
      budget.reserve(admitted.width, admitted.height);
    }
    for (const item of expected) {
      const admitted = admissions.find(a => sameMvImageIdentity(a.resource, item.resource));
      const bitmap = await createImageBitmap(new Blob([item.body], {type:item.resource.mimeType}));
      owned.add(bitmap);
      // Preserve the existing browser EXIF orientation behavior. Encoded geometry
      // admits allocation only; a 90-degree orientation swaps the real dimensions.
      if (!((bitmap.width === admitted.width && bitmap.height === admitted.height) || (bitmap.width === admitted.height && bitmap.height === admitted.width))) throw Error('Decoded image geometry differs from encoded admission');
      images.set(item.resource.id, bitmap);
      facts.push({resource:item.resource,width:bitmap.width,height:bitmap.height});
    }
    return {images,facts,close};
  } catch (error) { close(); throw error; }
}
`;
