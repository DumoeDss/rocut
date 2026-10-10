/** Browser IO only. Native Remotion supplies registration/timing/volume; Rust
 * validates observations and interprets source time after the isolated capture.
 * This mode produces metadata, never a successful picture or audible playback.
 */
import type { HyperframesNativeHistoryCapture } from "./hyperframes-native-history-capture";
import { REMOTION_PRODUCED_ASSET_BOOTSTRAP } from "./remotion-produced-asset-bootstrap";

export const REMOTION_AUDIO_BOOTSTRAP = REMOTION_PRODUCED_ASSET_BOOTSTRAP + String.raw`
const nativeAudioHandled = audioAnalysis !== null;
const nativeAudioAnalysis = nativeAudioHandled && audioAnalysis.mode !== 'picture';
const audioSources = new Map((audioAnalysis?.sources ?? []).map(source => [source.src, source.id]));
const audioAssets = new Map(), audioElements = new WeakSet();
const producedAssets = audioAnalysis?.remotionProduced ? createRocutRemotionProducedAssetCollector(audioAnalysis.limits,()=>audioAssets.size) : null;
let audioFailure;
const audioFail = message => { audioFailure ??= Error(message); throw audioFailure; };
function checkAudioElement(element, ready) {
  if (!(element instanceof HTMLMediaElement)) audioFail('Expected native audio/video element');
  if (!audioSources.has(element.currentSrc || element.src)) audioFail('Native audio source is not admitted');
  if (element.autoplay || !element.paused) audioFail('Native audio analysis cannot play wall-clock media');
  if (element.error) audioFail('Native audio metadata decode failed');
  if (element.readyState >= 1 && (!Number.isFinite(element.duration) || element.duration <= 0
      || element.duration > audioAnalysis.limits.maxSeconds)) audioFail('Native audio duration exceeds the Rust limit');
  if (ready && (!audioElements.has(element) || element.readyState < 1)) audioFail('Unregistered or unready native audio element');
}
Object.defineProperty(window, 'rocutRemotionAudio', {value:Object.freeze({
  enabled:nativeAudioHandled,
  analysisOnly:nativeAudioAnalysis,
  producedEnabled:!!producedAssets,
  maxProducedObservationBytes:audioAnalysis?.limits.maxObservationBytes,
  register(asset) {
    // Native picture rendering must not turn Artifact into an output promise.
    // The dedicated produced route alone admits, captures and persists bytes.
    if (!nativeAudioAnalysis && asset?.type === 'artifact') return;
    // Native soundtrack picture frames may register already-gained inline PCM;
    // soundtrack execution still belongs to the whole-source produced consumer.
    if (!nativeAudioAnalysis && nativeAudioHandled && asset?.type === 'inline-audio') return;
    if (!nativeAudioHandled) audioFail('Embedded audio requires Rocut mixing integration');
    if (asset && ['inline-audio','artifact'].includes(asset.type)) {
      if (!producedAssets) audioFail('Native produced assets require the owned PCM/artifact consumer');
      producedAssets.register(asset);return;
    }
    if (!asset || !['audio','video'].includes(asset.type)) audioFail('Native audio analysis cannot collect artifacts or inline PCM');
    const resourceId = audioSources.get(asset.src);
    if (!resourceId) audioFail('Native audio source is not admitted');
    if (typeof asset.id !== 'string' || asset.id.length > 256) audioFail('Invalid native audio asset ID');
    audioAssets.set(asset.id, {id:asset.id, resourceId, type:asset.type, frame:asset.frame,
      mediaFrame:asset.mediaFrame, audioStartFrame:asset.audioStartFrame, volume:asset.volume,
      playbackRate:asset.playbackRate ?? 1, toneFrequency:asset.toneFrequency ?? 1,
      audioStreamIndex:asset.audioStreamIndex ?? 0});
    if (audioAssets.size + (producedAssets?.size() ?? 0) > audioAnalysis.limits.maxAssetsPerFrame) audioFail('Native audio asset count exceeds the Rust limit');
  },
  unregister(id) { audioAssets.delete(id); producedAssets?.unregister(id); },
  registerElement(element) {
    if (!element) return;
    // Muting the DOM does not change native props/asset registration. No browser
    // playback is used to render the final soundtrack.
    element.muted = true; audioElements.add(element); checkAudioElement(element, false);
  },
  checkMedia(ready = false) {
    if (audioFailure) throw audioFailure;
    if (document.querySelector('iframe,object,embed,[data-composition-src]')) audioFail('Native audio analysis forbids nested media contexts');
    const elements = [...document.querySelectorAll('audio,video')];
    if (elements.length > audioAnalysis.limits.maxAssetsPerFrame) audioFail('Native audio element count exceeds the Rust limit');
    for (const element of elements) checkAudioElement(element, ready);
  },
  async metadata(element, signal) {
    const deadline = performance.now() + 8000;
    while (element.readyState < 1) {
      signal?.throwIfAborted(); checkAudioElement(element, false);
      if (performance.now() > deadline) audioFail('Native audio metadata timed out');
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    signal?.throwIfAborted(); checkAudioElement(element, false);
    return element.duration;
  },
  snapshot() {
    if (!nativeAudioAnalysis) audioFail('Native audio analysis was not requested');
    if (audioFailure) throw audioFailure;
    return [...audioAssets.values()];
  },
  producedSnapshot() {
    if (!producedAssets) audioFail('Native produced collection was not requested');
    return producedAssets.snapshot();
  },
  disposeProduced() { producedAssets?.dispose(); }
})});
`;

export interface NativeAudioAnalysisConfig {
	engine?: "remotion" | "hyperframes";
	mode?: "analysis" | "picture";
	/** Internal raw-fact collection only; does not enable graph rendering. */
	hyperframesGraph?: boolean;
	/** Internal whole-source scan, emitted and mapped exclusively by Rust. */
	hyperframesNativeHistory?: HyperframesNativeHistoryCapture;
	/** Exclusive full-canonical native produced scan; requires owned consumers. */
	remotionProduced?: {profile:"remotion-4.0.440-native-produced-frames-v1";canonicalStartFrame:0;canonicalEndFrameExclusive:number;
		nativeSampleRate:48000;frames:Record<string,unknown>[]};
	sources: { id: string; src: string }[];
	limits: { maxSeconds: number; maxAssetsPerFrame: number;maxSourceBytes?:number;maxTotalBytes?:number;maxObservationBytes?:number };
}
