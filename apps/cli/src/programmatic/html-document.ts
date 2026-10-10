import type { ResolvedProgrammaticResource } from "@opencut/editor-contracts";
import { htmlResourceBootstrap } from "./html-resources";
import { HTML_MEDIA_BOOTSTRAP } from "./html-media";
import { OFFTHREAD_BOOTSTRAP } from "./offthread-bootstrap";
import {
	REMOTION_AUDIO_BOOTSTRAP,
	type NativeAudioAnalysisConfig,
} from "./remotion-audio-bootstrap";
import { HYPERFRAMES_AUDIO_BOOTSTRAP } from "./hyperframes-audio-bootstrap";
import { HYPERFRAMES_AUDIO_GRAPH_BOOTSTRAP } from "./hyperframes-audio-graph-bootstrap";
import { HYPERFRAMES_NATIVE_HISTORY_CAPTURE } from "./hyperframes-native-history-capture";
import { REMOTION_PRODUCED_THUMBNAIL_CAPTURE } from "./remotion-produced-thumbnail-capture";
import { particleCaptureExpression } from "./particle-page-bootstrap";
import type { ParticlePageConfig } from "./particle-page-contract";
import {
	liquidObjectCaptureExpression,
	type LiquidObjectPageConfig,
} from "./liquid-object-page-capture";

/** Evaluated in an opaque-origin sandbox before any authored script executes.
 * No network, host bridge, storage, navigation, popup or nested browsing context.
 */
const BOOTSTRAP = String.raw`
const failures = [];
addEventListener('error', event => failures.push(event.message || 'HTML resource failed'), true);
addEventListener('unhandledrejection', () => failures.push('HTML promise rejected'));
addEventListener('securitypolicyviolation', () => failures.push('HTML external resource denied by CSP'));
let state = frame.seed >>> 0;
const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
Math.random = random;
addEventListener('DOMContentLoaded', async () => {
  try {
    for (const asset of document.querySelectorAll('img[data-rocut-src],video[data-rocut-src]'))
      asset.src = window.rocutResources.url(asset.getAttribute('data-rocut-src'));
    checkHtmlMedia();
    const author = window.rocut;
    if ((document.querySelector('canvas,video') || window.__timelines) && typeof author?.renderFrame !== 'function')
      throw Error('Canvas and timeline HTML must provide window.rocut.renderFrame(frame)');
    await resourcesReady;
    await author?.ready;
    void document.body?.offsetHeight;
    await document.fonts.ready;
    if (nativeAudioAnalysis && audioAnalysis.remotionProduced) {
      if (typeof author?.renderProducedFrames !== 'function')
        throw Error('Native Remotion produced assets require a matching compiled continuous-frame driver');
      const assets = await author.renderProducedFrames(audioAnalysis.remotionProduced);
      checkHtmlMedia(true);
      if (failures.length) throw Error(failures[0]);
      parent.postMessage({ tag: 'rocut-html-frame', ok: true, assets }, '*');
      return;
    }
    if (nativeAudioAnalysis && audioAnalysis.hyperframesNativeHistory) {
      const assets = await captureHyperframesNativeHistory(author, random);
      parent.postMessage({ tag: 'rocut-html-frame', ok: true, assets }, '*');
      return;
    }
    if (typeof author?.renderFrame === 'function') await author.renderFrame({ ...frame, random });
    // React/native engines may mount media only inside the frame hook.
    checkHtmlMedia(true);
    if (nativeAudioAnalysis) {
      if (failures.length) throw Error(failures[0]);
      parent.postMessage({ tag: 'rocut-html-frame', ok: true, assets: nativeAudioBridge.snapshot() }, '*');
      return;
    }
    // A newly attached srcdoc may not have instantiated CSS animations yet at
    // DOMContentLoaded, even after a layout read. Admit its first rendering turn.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const animations = document.getAnimations();
    for (const animation of animations) animation.pause();
    await Promise.all(animations.map(animation => animation.ready));
    for (const animation of animations) animation.currentTime = frame.time * 1000;
    // Chromium's compositor can retain a pre-seek transform even when the DOM
    // animation is paused at the requested time. Commit this frame and remove
    // compositor animation state before capture. Reject ambiguous overlap.
    const owned = new Map();
    for (const animation of animations) {
      const effect = animation.effect;
      if (!(effect instanceof KeyframeEffect) || effect.pseudoElement)
        throw Error('HTML CSS capture does not support pseudo-element/custom animation effects');
      const keys = new Set(effect.getKeyframes().flatMap(key => Object.keys(key)));
      const targetKeys = owned.get(effect.target) || new Set();
      for (const key of keys) {
        if (['offset','computedOffset','easing','composite'].includes(key)) continue;
        if (targetKeys.has(key)) throw Error('HTML CSS capture requires non-overlapping animated properties');
        targetKeys.add(key);
      }
      owned.set(effect.target, targetKeys);
    }
    for (const animation of animations) {
      if (animation.effect.getComputedTiming().progress !== null) animation.commitStyles();
      animation.cancel();
    }
    await Promise.all([...document.images].map(image => image.decode()));
    void document.body?.offsetHeight;
    await document.fonts.ready;
    // Flush paint without advancing animation time. Authors must not use a wall clock.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    checkHtmlMedia(true);
    if (failures.length) throw Error(failures[0]);
    parent.postMessage({ tag: 'rocut-html-frame', ok: true }, '*');
  } catch (error) {
    parent.postMessage({ tag: 'rocut-html-frame', error: String(error).slice(0, 1000) }, '*');
  }
}, { once: true });
`;

export function htmlCaptureExpression(
	code: string,
	frame: unknown,
	resources: readonly ResolvedProgrammaticResource[] = [],
	eagerImages = true,
	nativeVideoBridge = false,
	soundtrack?: NativeAudioAnalysisConfig,
	particle?: ParticlePageConfig,
): string {
	return htmlExpression({
		code,
		frame,
		resources,
		eagerImages,
		nativeVideoBridge,
		analysis: soundtrack ? { ...soundtrack, mode: "picture" } : null,
		particle,
	});
}

export function htmlLiquidObjectCaptureExpression({
	code,
	frame,
	resources,
	config,
}: {
	code: string;
	frame: unknown;
	resources: readonly ResolvedProgrammaticResource[];
	config: LiquidObjectPageConfig;
}): string {
	return htmlExpression({
		code,
		frame,
		resources,
		eagerImages: false,
		nativeVideoBridge: false,
		analysis: null,
		liquid: config,
	});
}

/** Internal analysis only; Electron's PNG-only contract is deliberately unchanged. */
export function htmlAudioAnalysisExpression(
	code: string,
	frame: unknown,
	resources: readonly ResolvedProgrammaticResource[],
	analysis: NativeAudioAnalysisConfig,
): string {
	return htmlExpression({
		code,
		frame,
		resources,
		eagerImages: true,
		nativeVideoBridge: !!analysis.remotionProduced,
		analysis,
	});
}

function htmlExpression({
	code,
	frame,
	resources,
	eagerImages,
	nativeVideoBridge,
	analysis,
	particle,
	liquid,
}: {
	code: string;
	frame: unknown;
	resources: readonly ResolvedProgrammaticResource[];
	eagerImages: boolean;
	nativeVideoBridge: boolean;
	analysis: NativeAudioAnalysisConfig | null;
	particle?: ParticlePageConfig;
	liquid?: LiquidObjectPageConfig;
}): string {
	if (particle && liquid)
		throw Error("HTML capture requires one native Three profile");
	// Native JSON modules use connect-src in Chromium. data: adds only in-memory
	// bytes; network/blob connections, workers and nested frames stay forbidden.
	const csp =
		"default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' data:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data:; connect-src data:; worker-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
	// Expose only the selected engine's registry. Authored code cannot register
	// Remotion assets to bypass HyperFrames media checks, or vice versa.
	const audioBootstrap =
		analysis?.engine === "hyperframes"
			? `const nativeAudioHandled = true;const nativeAudioAnalysis = audioAnalysis.mode !== 'picture';${analysis.hyperframesGraph ? HYPERFRAMES_AUDIO_GRAPH_BOOTSTRAP : ""}${HYPERFRAMES_AUDIO_BOOTSTRAP}const nativeAudioBridge = window.rocutHyperframesAudio;`
			: `${REMOTION_AUDIO_BOOTSTRAP}const nativeAudioBridge = window.rocutRemotionAudio;`;
	const bootstrap = `const frame=${JSON.stringify(frame).replace(/</g, "\\u003c")};const nativeVideoBridge=${nativeVideoBridge};const audioAnalysis=${JSON.stringify(analysis).replace(/</g, "\\u003c")};${audioBootstrap}${htmlResourceBootstrap(resources, eagerImages)}${HTML_MEDIA_BOOTSTRAP}${OFFTHREAD_BOOTSTRAP}${analysis?.hyperframesNativeHistory ? HYPERFRAMES_NATIVE_HISTORY_CAPTURE : ""}${analysis?.remotionProduced ? REMOTION_PRODUCED_THUMBNAIL_CAPTURE : ""}${BOOTSTRAP}`;
	if (particle)
		return particleCaptureExpression({
			config: particle,
			bootstrap,
			code,
			csp,
		});
	if (liquid)
		return liquidObjectCaptureExpression({
			config: liquid,
			bootstrap,
			code,
			csp,
		});
	const document = `<meta http-equiv="Content-Security-Policy" content="${csp}"><script>${bootstrap}</script>${code}`;
	// A posted audio snapshot is complete without another rendering turn. Only
	// picture capture needs the outer compositor paint barrier.
	return `new Promise((resolve, reject) => {
    document.documentElement.style.cssText = 'margin:0; background:transparent';
    document.body.style.cssText = 'margin:0; background:transparent; overflow:hidden';
    const iframe = document.createElement('iframe');
    iframe.sandbox = 'allow-scripts';
    iframe.style.cssText = 'position:fixed; inset:0; width:100%; height:100%; border:0; background:transparent';
    Object.defineProperty(window, '__rocutNativeFrameReply', {value:reply => {
      iframe.contentWindow?.postMessage({tag:'rocut-native-frame-reply',reply}, '*');
    }});
    Object.defineProperty(window, '__rocutProducedCaptureReply', {value:reply => {
      iframe.contentWindow?.postMessage({tag:'rocut-produced-capture-reply',reply}, '*');
    }});
    addEventListener('message', event => {
      if (event.source !== iframe.contentWindow) return;
      if (event.data?.tag === 'rocut-produced-capture-request') {
        if (typeof window.__rocutProducedCaptureRequest === 'function' && typeof event.data.payload === 'string')
          window.__rocutProducedCaptureRequest(event.data.payload);
        else reject(Error('Native produced capture transport is unavailable'));
        return;
      }
      if (event.data?.tag === 'rocut-native-frame-request') {
        if (typeof window.__rocutNativeFrameRequest === 'function' && typeof event.data.payload === 'string')
          window.__rocutNativeFrameRequest(event.data.payload);
        else reject(Error('Native frame transport is unavailable'));
        return;
      }
      if (event.data?.tag !== 'rocut-html-frame') return;
      if (event.data.ok) ${analysis && analysis.mode !== "picture" ? "resolve(event.data.assets)" : "requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))"};
      else reject(Error(event.data.error));
    });
    iframe.srcdoc = ${JSON.stringify(document)};
    document.body.appendChild(iframe);
  })`;
}
