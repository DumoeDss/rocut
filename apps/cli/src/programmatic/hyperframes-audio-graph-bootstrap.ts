/**
 * Standalone pinned-runtime IO collector. Not wired into the current gain-only
 * path. The host must register admitted bytes/authored mute before begin/seek.
 * Rust owns source admission, budgets, graph edges, numeric policy and faders.
 */
export const HYPERFRAMES_AUDIO_GRAPH_BOOTSTRAP = String.raw`
(() => {
  const registered = new Map(), captured = new Map(), clips = new Map();
  let frameTime = null, failure;
  const fail = message => { failure ??= Error(message); throw failure; };
  const healthy = () => { if (failure) throw failure; };
  const number = (value, field) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail('Missing finite native graph fact: ' + field);
    return value;
  };
  const stamp = element => {
    const id = element.getAttribute('data-hf-render-id');
    if (!id) fail('HyperFrames graph needs compiled instance stamps; explicitly recompile');
    return id;
  };
  const source = element => element.currentSrc || element.src || element.querySelector('source')?.src;
  const attributes = element => ({
    groupRenderId: element.getAttribute('data-hf-group-render-id'), groupAuthorId: element.getAttribute('data-audio-group'),
    fxChain: element.getAttribute('data-fx-chain'), automation: element.getAttribute('data-automation'),
    muted: element.hasAttribute('muted'), hasAudio: element.getAttribute('data-has-audio')
  });
  // Copy JSON facts without interpreting rate curves, faders or keyframe clocks.
  const copy = (value, ancestors = new Set()) => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') return number(value, 'JSON value');
    if (typeof value !== 'object' || ancestors.has(value)) fail('Native graph fact is not finite JSON data');
    if (value instanceof HTMLMediaElement || (!Array.isArray(value) && Object.prototype.toString.call(value) !== '[object Object]'))
      fail('Native graph fact is not a JSON object');
    ancestors.add(value);
    const result = Array.isArray(value) ? value.map(item => copy(item, ancestors))
      : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item, ancestors)]));
    ancestors.delete(value);
    return result;
  };
  const nativeFacts = clip => {
    const result = {};
    for (const key of ['start','end','duration','mediaStart','sourceDuration','playbackRate'])
      result[key] = number(clip[key], key);
    if (typeof clip.loop !== 'boolean') fail('Missing native graph loop fact');
    result.loop = clip.loop;
    result.volume = clip.volume === null ? null : number(clip.volume, 'volume');
    if (clip.rate === undefined || clip.fades === undefined) fail('Missing native graph rate/fades facts');
    result.rate = copy(clip.rate);
    result.fades = copy(clip.fades);
    if (clip.volumeKeyframes !== undefined) result.volumeKeyframes = copy(clip.volumeKeyframes);
    return result;
  };
  Object.defineProperty(window, 'rocutHyperframesAudioGraph', { value: Object.freeze({
    registerMedia(element, declaration) {
      healthy();
      if (!(element instanceof HTMLMediaElement)) fail('Expected native graph media element');
      if (typeof declaration?.resourceId !== 'string' || !declaration.resourceId
          || typeof declaration.authoredMuted !== 'boolean') fail('Native graph media lacks host admission facts');
      const instanceId = stamp(element);
      const src = source(element);
      if (!src) fail('Native graph media lacks a resolved source');
      const previous = registered.get(element);
      if (previous && previous.instanceId !== instanceId) fail('Native graph instance identity changed after registration');
      if (previous && (previous.resourceId !== declaration.resourceId || previous.authoredMuted !== declaration.authoredMuted
          || previous.src !== src)) fail('Native graph media registration changed');
      registered.set(element, { instanceId, resourceId: declaration.resourceId, authoredMuted: declaration.authoredMuted, src });
    },
    begin(frame) {
      healthy();
      frameTime = number(frame?.time, 'requested time');
      captured.clear();
      clips.clear();
    },
    collectTrack(element, clip, observedAt) {
      healthy();
      if (frameTime === null) return;
      const declaration = registered.get(element);
      if (!declaration) fail('Unregistered native graph media');
      if (!clip || clip.el !== element) fail('Native graph clip/element mismatch');
      if (stamp(element) !== declaration.instanceId) fail('Native graph instance identity changed after registration');
      if (source(element) !== declaration.src) fail('Native graph source changed after admission');
      const track = {
        instanceId: stamp(element), authorId: element.getAttribute('id'), resourceId: declaration.resourceId,
        type: element.tagName === 'VIDEO' ? 'video' : 'audio', authoredMuted: declaration.authoredMuted,
        ancestorHidden: element.closest('[data-hidden]') !== null,
        observedAt: number(observedAt, 'observed time'), native: nativeFacts(clip),
        resolvedAuthorGain: {state:'unobserved'},
        attributes: attributes(element)
      };
      const previous = captured.get(element);
      if (previous && previous.instanceId !== track.instanceId) fail('Native graph instance identity changed');
      captured.set(element, track);
      clips.set(element, clip);
    },
    collectResolvedAuthorGain(element, clip, observedAt, gain) {
      healthy();
      if (frameTime === null) return;
      const track = captured.get(element);
      if (!track || clips.get(element) !== clip || clip.el !== element)
        fail('Resolved author gain lacks matching native clip observation');
      if (number(observedAt, 'resolved author gain time') !== track.observedAt)
        fail('Resolved author gain time differs from native clip observation');
      if (!gain || !['normalized-volume-lane','normalized-GSAP','fallback'].includes(gain.source))
        fail('Missing native resolved author gain source');
      number(gain.gainBeforeFades, 'resolved author gain');
      if (!gain.fades || (gain.source === 'fallback'
          ? gain.points !== null || !gain.fallback || typeof gain.fallback.routed !== 'boolean'
          : !Array.isArray(gain.points) || gain.points.length === 0 || gain.fallback !== null))
        fail('Missing native resolved author gain envelope facts');
      track.resolvedAuthorGain = {...copy(gain), state:'observed', observedAt};
    },
    snapshot() {
      healthy();
      if (frameTime === null) fail('Native graph collection has not begun');
      const media = [...document.querySelectorAll('audio,video')], tracks = [], buses = [], ids = new Set();
      const unique = element => {
        const id = stamp(element);
        if (ids.has(id)) fail('Duplicate native graph instance ID: ' + id);
        ids.add(id); return id;
      };
      if (captured.size !== media.length) fail('Missing or stale native graph clip facts');
      for (const element of media) {
        const track = captured.get(element);
        if (!track || unique(element) !== track.instanceId) fail('Missing or changed native graph clip identity');
        if (track.instanceId !== registered.get(element)?.instanceId) fail('Native graph instance identity changed after registration');
        if (source(element) !== registered.get(element)?.src) fail('Native graph source changed after collection');
        if (JSON.stringify(attributes(element)) !== JSON.stringify(track.attributes)
            || (element.closest('[data-hidden]') !== null) !== track.ancestorHidden)
          fail('Native graph attributes changed after collection');
        tracks.push(copy(track));
      }
      for (const element of document.querySelectorAll('hf-audio-group')) {
        if (element.hasAttribute('data-audio-group') || element.hasAttribute('data-hf-group-render-id'))
          fail('Native graph preparation supports track-to-bus membership only');
        buses.push({ instanceId: unique(element), authorId: element.getAttribute('id'), hidden: element.hasAttribute('data-hidden'),
          attributes: { volume: element.getAttribute('data-volume'), fxChain: element.getAttribute('data-fx-chain'),
            automation: element.getAttribute('data-automation') } });
      }
      return { version: 1, nativeVersion: '0.8.139', time: frameTime, tracks, buses };
    }
  }) });
})();
`;
