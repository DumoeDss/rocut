/** Worker-local IO/lifetime checks. Selection and policy budgets come from Rust. */
export const SEQUENCE_IMAGE_DECODER_SOURCE = String.raw`
async function decodeMvSequenceImages(frame, resolved, sharedBudget) {
  const selected = frame.sequenceImages || [];
  const images = new Map(), owned = new Set(), decoded = new Map();
  const close = () => { for (const bitmap of owned) bitmap.close(); owned.clear(); images.clear(); };
  try {
    if (!Array.isArray(resolved) || resolved.length !== selected.length) throw Error('Missing selected sequence images');
    const limits = frame.sequenceLimits;
    if (selected.length && (!limits || !Number.isSafeInteger(limits.maxDecodedBytes) || limits.maxDecodedBytes <= 0 || !Number.isSafeInteger(limits.maxDimension) || limits.maxDimension <= 0)) throw Error('Missing sequence decode limits');
    const keys = new Set(), geometry = new Map();
    let bytes = 0;
    for (let i = 0; i < selected.length; i++) {
      const need = selected[i], item = resolved[i];
      if (!item || keys.has(need.imageKey) || item.imageKey !== need.imageKey || JSON.stringify(item.resource) !== JSON.stringify(need.resource) || !(item.body instanceof ArrayBuffer) || item.body.byteLength !== need.resource.byteLength || need.resource.kind !== 'image') throw Error('Selected sequence image mismatch');
      keys.add(need.imageKey);
      if (![need.width, need.height].every(v => Number.isSafeInteger(v) && v > 0 && v <= limits.maxDimension)) throw Error('Invalid sequence image geometry');
      const digestKey = JSON.stringify([need.resource.sha256, need.resource.mimeType, need.resource.byteLength]);
      const sizeKey = JSON.stringify([need.width, need.height]);
      if (geometry.has(digestKey) && geometry.get(digestKey) !== sizeKey) throw Error('Conflicting sequence image geometry');
      if (!geometry.has(digestKey)) {
        bytes += need.width * need.height * 4; geometry.set(digestKey, sizeKey);
        if (sharedBudget) sharedBudget.reserve(need.width, need.height);
      }
      if (!Number.isSafeInteger(bytes) || bytes > limits.maxDecodedBytes) throw Error('Sequence decode budget exceeded');
    }
    for (let i = 0; i < selected.length; i++) {
      const need = selected[i], item = resolved[i];
      const key = JSON.stringify([need.resource.sha256, need.resource.mimeType, need.resource.byteLength]);
      let bitmap = decoded.get(key);
      if (!bitmap) {
        bitmap = await createImageBitmap(new Blob([item.body], {type: need.resource.mimeType}));
        owned.add(bitmap);
        if (bitmap.width !== need.width || bitmap.height !== need.height) throw Error('Decoded sequence image dimensions do not match manifest');
        decoded.set(key, bitmap);
      }
      images.set(need.imageKey, bitmap);
    }
    return {images, close};
  } catch (error) { close(); throw error; }
}
`;
