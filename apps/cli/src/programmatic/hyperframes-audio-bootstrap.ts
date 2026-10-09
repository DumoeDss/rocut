/** Pinned-runtime IO bridge. Timing, loop mapping, fades and authored volume
 * are observed at HyperFrames' native sync point, never recreated from DOM data.
 * The browser remains silent; Rocut decodes and mixes the admitted source bytes.
 */
export const HYPERFRAMES_AUDIO_BOOTSTRAP = String.raw`
const hyperframesAudioEnabled = audioAnalysis?.engine === 'hyperframes';
const hyperframesAudioGraphEnabled = hyperframesAudioEnabled && audioAnalysis.hyperframesGraph === true;
const hyperframesAudioSources = new Map((audioAnalysis?.sources ?? []).map(source => [source.src, source.id]));
const hyperframesAudioElements = new Map(), hyperframesAudioAssets = new Map();
let hyperframesAudioFrame = null, hyperframesAudioFailure;
const hyperframesAudioFail = message => {
  hyperframesAudioFailure ??= Error(message); throw hyperframesAudioFailure;
};
function hyperframesCheckElement(element, ready) {
  if (!(element instanceof HTMLMediaElement)) hyperframesAudioFail('Expected HyperFrames native media');
  // Recheck each frame: scripts can change graph membership after registration.
  if (!hyperframesAudioGraphEnabled && (element.hasAttribute('data-audio-group') || element.hasAttribute('data-hf-group-render-id') || element.closest('[data-fx-chain]')))
    hyperframesAudioFail('HyperFrames audio groups and FX chains require the native audio graph adapter');
  const automation = element.getAttribute('data-automation');
  if (automation && !hyperframesAudioGraphEnabled) {
    let parsed;
    try { parsed = JSON.parse(automation); } catch { hyperframesAudioFail('Invalid HyperFrames audio automation'); }
    if (!Array.isArray(parsed?.lanes) || parsed.lanes.some(lane => lane.target !== 'volume'))
      hyperframesAudioFail('HyperFrames rate and FX automation require the native audio graph adapter');
  }
  const src = element.currentSrc || element.src || element.querySelector('source')?.src;
  if (!hyperframesAudioSources.has(src)) hyperframesAudioFail('HyperFrames audio source is not admitted');
  if (element.autoplay || !element.paused) hyperframesAudioFail('HyperFrames audio cannot use wall-clock playback');
  if (element.error) hyperframesAudioFail('HyperFrames audio metadata decode failed');
  if (element.readyState >= 1 && (!Number.isFinite(element.duration) || element.duration <= 0
      || element.duration > audioAnalysis.limits.maxSeconds)) hyperframesAudioFail('HyperFrames audio duration exceeds the Rust limit');
  if (ready && (!hyperframesAudioElements.has(element) || element.readyState < 1))
    hyperframesAudioFail('Unregistered or unready HyperFrames audio element');
  return src;
}
function hyperframesRegister(element) {
  hyperframesCheckElement(element, false);
  if (!hyperframesAudioElements.has(element)) {
    if ((!hyperframesAudioGraphEnabled && !element.id) || !element.hasAttribute('data-start'))
      hyperframesAudioFail('HyperFrames native audio requires an ID and native timeline start');
    if (!hyperframesAudioGraphEnabled && [...hyperframesAudioElements.keys()].some(other => other.id === element.id))
      hyperframesAudioFail('Duplicate HyperFrames native media ID');
    hyperframesAudioElements.set(element, {
      muted: element.hasAttribute('muted') || element.defaultMuted || element.muted
        || (element.tagName === 'VIDEO' && element.getAttribute('data-has-audio') === 'false')
    });
    if (hyperframesAudioGraphEnabled) {
      if (!window.rocutHyperframesAudioGraph) hyperframesAudioFail('HyperFrames graph collection bridge is unavailable');
      window.rocutHyperframesAudioGraph.registerMedia(element, {
        resourceId: hyperframesAudioSources.get(hyperframesCheckElement(element, false)),
        authoredMuted: hyperframesAudioElements.get(element).muted
      });
    }
  }
  // Do not add a muted HTML attribute: upstream uses it to classify audible video.
  element.muted = true;
}
Object.defineProperty(window, 'rocutHyperframesAudio', {value:Object.freeze({
  enabled: hyperframesAudioEnabled,
  analysisOnly: hyperframesAudioEnabled && audioAnalysis.mode !== 'picture',
  checkMedia(ready = false) {
    if (!hyperframesAudioEnabled) hyperframesAudioFail('HyperFrames native audio requires Rocut mixing integration');
    if (hyperframesAudioFailure) throw hyperframesAudioFailure;
    if (document.querySelector('iframe,object,embed,[data-composition-src]'))
      hyperframesAudioFail('HyperFrames native audio forbids unresolved nested contexts');
    const elements = [...document.querySelectorAll('audio,video')];
    if (elements.length > audioAnalysis.limits.maxAssetsPerFrame)
      hyperframesAudioFail('HyperFrames native audio element count exceeds the Rust limit');
    for (const element of elements) { hyperframesRegister(element); hyperframesCheckElement(element, ready); }
  },
  async prepare() {
    if (window.__rocutHyperframesAudioAdapter !== 1)
      hyperframesAudioFail('HyperFrames bundle was not compiled with native audio; explicitly recompile it');
    this.checkMedia();
    const deadline = performance.now() + 8000;
    await Promise.all([...hyperframesAudioElements.keys()].map(async element => {
      element.preload = 'auto';
      while (element.readyState < 1) {
        hyperframesCheckElement(element, false);
        if (performance.now() > deadline) hyperframesAudioFail('HyperFrames audio metadata timed out');
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
      hyperframesCheckElement(element, true);
    }));
  },
  begin(frame) {
    if (!hyperframesAudioEnabled) hyperframesAudioFail('HyperFrames native audio was not requested');
    hyperframesAudioFrame = frame;
    hyperframesAudioAssets.clear();
    if (hyperframesAudioGraphEnabled) window.rocutHyperframesAudioGraph.begin(frame);
  },
  observe(element, observation) {
    if (hyperframesAudioGraphEnabled) return;
    if (!hyperframesAudioEnabled || !hyperframesAudioFrame) return;
    if (Math.abs(observation.time - hyperframesAudioFrame.time) > 1e-7) return;
    const declared = hyperframesAudioElements.get(element);
    if (!declared) hyperframesAudioFail('Unregistered HyperFrames native audio observation');
    const src = hyperframesCheckElement(element, true);
    hyperframesAudioAssets.set(element.id, { ...observation, id: element.id,
      resourceId: hyperframesAudioSources.get(src), type: element.tagName === 'VIDEO' ? 'video' : 'audio',
      muted: declared.muted });
  },
  snapshot() {
    if (!hyperframesAudioEnabled || audioAnalysis.mode === 'picture') hyperframesAudioFail('HyperFrames audio analysis was not requested');
    this.checkMedia(true);
    if (hyperframesAudioGraphEnabled) return window.rocutHyperframesAudioGraph.snapshot();
    return [...hyperframesAudioAssets.values()];
  }
})});
`;
