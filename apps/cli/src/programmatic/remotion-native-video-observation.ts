/** Passive native video diagnostics. Never invoke getters or add native work. */
export const REMOTION_NATIVE_VIDEO_OBSERVATION_SOURCE = String.raw`
(() => {
  const ids = new WeakMap();
  const events = [];
  let nextId = 0, sequence = 0, dropped = 0;
  const publish = () => Object.defineProperty(readinessDiagnostic, 'nativeVideo', {value:Object.freeze({
    profile:'passive-remotion-native-video-v1', events:Object.freeze(events.slice()), dropped, sequence
  }), configurable:true, enumerable:true});
  const numberKeys = ['currentTime','target','frame','absoluteFrame','mediaStartsAt','fps','playbackRate',
    'handle','attempt','threshold','difference','callbackNow','expectedDisplayTime','displayIn',
    'mediaTime','presentationTime','presentedFrames','duration','readyState','networkState','errorCode'];
  const booleanKeys = ['withinThreshold','seeking','paused','isConnected'];
  const kinds = new Set(['effect-target','effect-handle','effect-test-release','effect-equal-ready-release',
    'effect-loadeddata-release','effect-loadeddata-cleanup','effect-ended-release','effect-seek-success-release',
    'effect-cleanup-release','seek-request','seek-equal-return','seek-command','seek-rvfc','seek-presented-release',
    'seek-display-delay','seeked','seek-cancel','attempt-duration-return','attempt-start','attempt-result',
    'attempt-cancel','settle-done','html-ready-before-message']);
  const own = (object, key) => {
    if ((typeof object !== 'object' && typeof object !== 'function') || object === null) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
  };
  const numeric = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
  const boolean = value => typeof value === 'boolean' ? value : null;
  const method = (object, key) => {
    for (let depth = 0; object && depth < 8; depth++, object = Object.getPrototypeOf(object)) {
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      if (descriptor) return 'value' in descriptor && typeof descriptor.value === 'function' ? descriptor.value : null;
    }
    return null;
  };
  const identity = element => {
    if ((typeof element !== 'object' && typeof element !== 'function') || element === null) return null;
    let item = ids.get(element);
    if (!item) { item = {id:++nextId}; ids.set(element, item); }
    return item;
  };
  const record = (kind, element, values, metadata) => {
    try {
      if (!kinds.has(kind)) return;
      const item = identity(element), fields = {};
      for (const key of numberKeys) {
        const value = own(values, key);
        if (value !== undefined) fields[key] = numeric(value);
      }
      for (const key of booleanKeys) {
        const value = own(values, key);
        if (value !== undefined) fields[key] = boolean(value);
      }
      for (const key of ['presentationTime','presentedFrames']) fields[key] = numeric(own(metadata, key));
      if (kind === 'effect-target') fields.fps = numeric(own(metadata, 'fps'));
      if (item) for (const key of ['currentTime','target','mediaTime'])
        if (fields[key] !== undefined) item[key] = fields[key];
      if (kind === 'attempt-result' && fields.attempt === 3 && fields.target !== null &&
          fields.mediaTime !== null && fields.threshold !== null && fields.target !== undefined &&
          fields.mediaTime !== undefined && fields.threshold !== undefined) {
        fields.difference = Math.abs(fields.target - fields.mediaTime);
        fields.withinThreshold = fields.difference <= fields.threshold;
      }
      const event = {sequence:sequence++, kind, elementId:item?.id ?? null,
        frameIndex:numeric(own(readinessDiagnostic, 'frameIndex')), ...fields};
      if (kind === 'settle-done' || kind === 'html-ready-before-message') {
        const select = method(document, 'querySelectorAll');
        const videoNodes = select ? select.call(document, 'video') : null;
        // Snapshot data descriptors only. Native DOM accessors remain unknown;
        // the consumed native target/currentTime/presentation stay in the trace.
        const admitted = [];
        for (let index = 0; index < 8; index++) {
          const video = own(videoNodes, String(index));
          if (video !== undefined) admitted.push(video);
        }
        event.snapshotCount = admitted.length;
        event.videos = admitted.map(video => {
          const entry = identity(video), snapshot = {elementId:entry.id};
          for (const key of ['currentTime','duration','readyState','networkState']) snapshot[key] = numeric(own(video, key));
          for (const key of ['seeking','paused','isConnected']) snapshot[key] = boolean(own(video, key));
          for (const key of ['currentTime','target','mediaTime']) snapshot['lastNative'+key[0].toUpperCase()+key.slice(1)] = entry[key] ?? null;
          return Object.freeze(snapshot);
        });
        Object.freeze(event.videos);
      }
      if (events.length === 128) { events.shift(); dropped++; }
      events.push(Object.freeze(event));
      publish();
    } catch { /* Observation must never consume a getter or replace native work. */ }
  };
  try { publish(); Object.defineProperty(window, '__rocutRemotionNativeVideoObserve', {value:record}); }
  catch { /* Existing author properties must not become a new admission gate. */ }
})();
`;
