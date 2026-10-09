/** Trusted byte transport only. No project scripts, timing/fader arithmetic,
 * FX approximation, partial seeking, output clamp or mastering lives here. */
export const HYPERFRAMES_FX_BOOTSTRAP = String.raw`
(() => {
  const chunkBytes = 65536;
  const NativeOfflineAudioContext = window.OfflineAudioContext;
  if (typeof NativeOfflineAudioContext !== 'function' || !window.isSecureContext)
    throw Error('Native FX requires a secure OfflineAudioContext');
  let phase = 'new', plan, input, uploaded = 0, output;
  const fail = message => { phase = 'failed'; throw Error(message); };
  const integer = value => Number.isSafeInteger(value) && value >= 0;
  Object.defineProperty(window, 'OfflineAudioContext', { value: class extends NativeOfflineAudioContext {
    constructor(channels, frames, sampleRate) {
      if (phase !== 'rendering' || channels !== 2 || frames !== plan.expectedOutputFrames
          || sampleRate !== plan.sampleRate || frames * 8 > plan.maxOutputBytes)
        fail('Native FX context disagrees with admitted output geometry');
      super(channels, frames, sampleRate);
    }
  }});
  Object.defineProperty(window, 'rocutNativeFxIO', { value: Object.freeze({
    configure(value) {
      if (phase !== 'new' || !integer(value.inputFrames) || !integer(value.expectedOutputFrames)
          || !integer(value.maxOutputBytes) || !Number.isFinite(value.sampleRate)
          || value.sampleRate <= 0 || !integer(value.inputFrames * 8)
          || !integer(value.expectedOutputFrames * 8)
          || value.expectedOutputFrames * 8 > value.maxOutputBytes)
        fail('Invalid admitted native FX IO geometry');
      plan = value;
      input = new Uint8Array(value.inputFrames * 8);
      phase = 'uploading';
    },
    put(offset, base64) {
      if (phase !== 'uploading' || offset !== uploaded || typeof base64 !== 'string'
          || base64.length > Math.ceil(chunkBytes / 3) * 4)
        fail('Invalid native FX upload chunk');
      const binary = atob(base64);
      if (!binary.length || binary.length > chunkBytes || uploaded + binary.length > input.byteLength)
        fail('Native FX upload exceeds admitted input');
      for (let i = 0; i < binary.length; i++) input[uploaded + i] = binary.charCodeAt(i);
      uploaded += binary.length;
    },
    async render(chainJson, automationJson) {
      if (phase !== 'uploading' || uploaded !== input.byteLength)
        fail('Incomplete native FX input');
      if (typeof window.__HF_AUDIO_FX?.render !== 'function') fail('Missing reviewed native FX runtime');
      phase = 'rendering';
      const channels = [new Float32Array(plan.inputFrames), new Float32Array(plan.inputFrames)];
      const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
      for (let frame = 0; frame < plan.inputFrames; frame++) {
        for (let channel = 0; channel < 2; channel++) {
          const sample = view.getFloat32((frame * 2 + channel) * 4, true);
          if (!Number.isFinite(sample)) fail('Nonfinite native FX input PCM');
          channels[channel][frame] = sample;
        }
      }
      input = null;
      // The actual core 0.8.139 implementation, including its native worklets,
      // automation scheduler and tail calculation. Rust predicts its geometry;
      // this adapter checks the result, it never replaces those algorithms.
      output = await window.__HF_AUDIO_FX.render(channels, plan.sampleRate, chainJson, automationJson);
      if (!Array.isArray(output) || output.length !== 2 || output.some(channel =>
          !(channel instanceof Float32Array) || channel.length !== plan.expectedOutputFrames))
        fail('Native FX output disagrees with admitted PCM geometry');
      phase = 'ready';
      return { frames: plan.expectedOutputFrames, bytes: plan.expectedOutputFrames * 8, channels: 2 };
    },
    read(offset, count) {
      if (phase !== 'ready' || !integer(offset) || !integer(count) || !count
          || offset % 8 || count % 8 || count > chunkBytes
          || offset + count > plan.expectedOutputFrames * 8)
        fail('Invalid native FX output chunk');
      const bytes = new Uint8Array(count), view = new DataView(bytes.buffer);
      for (let byte = 0; byte < count; byte += 8) {
        const frame = (offset + byte) / 8;
        for (let channel = 0; channel < 2; channel++) {
          const sample = output[channel][frame];
          if (!Number.isFinite(sample)) fail('Nonfinite native FX output PCM');
          view.setFloat32(byte + channel * 4, sample, true);
        }
      }
      let binary = '';
      for (let byte = 0; byte < count; byte += 8192)
        binary += String.fromCharCode(...bytes.subarray(byte, Math.min(byte + 8192, count)));
      return btoa(binary);
    },
    dispose() { input = output = plan = null; phase = 'disposed'; }
  })});
})();
`;
