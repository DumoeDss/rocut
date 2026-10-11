import { hyperframesFxDigest } from "./hyperframes-fx-runtime";

export const HYPERFRAMES_FX_ORIGIN = "https://rocut-native-fx.invalid/";
export const HYPERFRAMES_FX_MODULE_URL = `${HYPERFRAMES_FX_ORIGIN}__reviewed-audio-worklet.js`;
export const HYPERFRAMES_FX_WORKLET_BINDING =
	"__rocutReviewedAudioWorkletRequest";
export const HYPERFRAMES_FX_WORKLET_REPLY = "__rocutReviewedAudioWorkletReply";
export const HYPERFRAMES_FX_WORKLET_SHA256 =
	"42ea2bb89b51944e1ed848553d944a78b15fc55f676a8d139942434543d00c49";
export const HYPERFRAMES_FX_WORKLET_BYTES = 12884;

/** Decode and retain the exact reviewed bytes, never a project-provided digest. */
export function decodeReviewedHyperframesWorklet(
	url: unknown,
): Buffer | undefined {
	const prefix = "data:text/javascript;base64,";
	if (
		typeof url !== "string" ||
		!url.startsWith(prefix) ||
		url.length > prefix.length + Math.ceil(HYPERFRAMES_FX_WORKLET_BYTES / 3) * 4
	)
		return undefined;
	const encoded = url.slice(prefix.length);
	const bytes = Buffer.from(encoded, "base64");
	if (
		bytes.length !== HYPERFRAMES_FX_WORKLET_BYTES ||
		bytes.toString("base64") !== encoded ||
		hyperframesFxDigest(bytes) !== HYPERFRAMES_FX_WORKLET_SHA256
	)
		return undefined;
	return bytes;
}

/** Chromium skips Fetch for data: worklets. Replace that path before any DSP
 * runtime runs; CSP admits only the fixed HTTPS module served from checked bytes.
 * A forged success reply still cannot supply unchecked bytes to that URL. */
export const HYPERFRAMES_FX_WORKLET_GATE = `(() => {
 const binding = window.${HYPERFRAMES_FX_WORKLET_BINDING};
 if (typeof binding !== 'function') throw new Error('Native audio worklet binding unavailable');
 const stringify = JSON.stringify;
 const pending = new Map(); let nextId = 1;
 Object.defineProperty(window, '${HYPERFRAMES_FX_WORKLET_REPLY}', {
  value: ({id, ok}) => { const item = pending.get(id); if (!item) return; pending.delete(id); ok === true ? item.resolve() : item.reject(new Error('Native audio worklet was not reviewed')); },
  writable: false, configurable: false,
 });
 const context = new OfflineAudioContext(1, 1, 48000);
 let prototype = Object.getPrototypeOf(context.audioWorklet);
 while (prototype && !Object.prototype.hasOwnProperty.call(prototype, 'addModule')) prototype = Object.getPrototypeOf(prototype);
 if (!prototype) throw new Error('Native audio worklet API unavailable');
 const original = prototype.addModule;
 if (typeof original !== 'function') throw new Error('Native audio worklet API unavailable');
 Object.defineProperty(prototype, 'addModule', {
  value: function(url, options) {
   const target = this;
   if (typeof url !== 'string' || url.length > 18000 || pending.size >= 2 || !Number.isSafeInteger(nextId)) return Promise.reject(new Error('Native audio worklet was not reviewed'));
   const id = nextId++;
   return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try { binding(stringify({ version: 1, id, url })); } catch (error) { pending.delete(id); reject(error); }
   }).then(() => original.call(target, ${JSON.stringify(HYPERFRAMES_FX_MODULE_URL)}, options));
  }, writable: false, configurable: false,
 });
})()`;
