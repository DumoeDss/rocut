/** Browser IO/readiness only. Engine timing belongs to the native adapter;
 * resource/decoder policy comes from the Rust-resolved frame, never author code.
 * This is not an audio renderer: audible media must not silently disappear.
 */
export const HTML_MEDIA_BOOTSTRAP = String.raw`
const managedVideos = new WeakSet();

let nativeFrame;
function nativeTimeoutError(scope) {
  const message = 'HTML native video presentation timed out';
  try {
    const number = value => Number.isFinite(value) ? value : null;
    const videos = scope.videos.map((video, ordinal) => {
      const state = scope.states.get(video);
      const observed = state?.observe(), callback = observed?.lastCallback;
      const nativeSeek = observed ? {target: number(observed.target), landed: Boolean(observed.landed),
        callbackCount: number(observed.callbackCount), assignmentStartedAt: number(observed.assignmentStartedAt),
        sameSource: Boolean(observed.sameSource), lastCallback: callback ? {mediaTime: number(callback.mediaTime),
          presentationTime: number(callback.presentationTime), presentedFrames: number(callback.presentedFrames)} : null} : null;
      return {ordinal, currentTime: number(video.currentTime), duration: number(video.duration),
        readyState: number(video.readyState), networkState: number(video.networkState),
        seeking: Boolean(video.seeking), paused: Boolean(video.paused), errorCode: number(video.error?.code),
        nativeSeek};
    });
    const stages = ['begin-native-frame', 'native-audio-prepare', 'media-metadata-and-initial-zero',
      'runtime-readiness', 'native-render-seek', 'upstream-seek-completion', 'native-seek-drain',
      'media-settle', 'gpu-reseek', 'gpu-upstream-seek-completion', 'gpu-native-seek-drain', 'final-media-check'];
    const stage = stages.includes(scope.stage) ? scope.stage : 'unknown';
    return Error(message + ' ' + JSON.stringify({stage, videos}));
  } catch {
    // Observers must never replace the original failure with a diagnostic error.
    return Error(message + ' {"diagnosticUnavailable":true}');
  }
}
function observeNativeCallback(state, metadata) {
  try {
    const number = key => {
      const descriptor = Object.getOwnPropertyDescriptor(metadata, key);
      return descriptor && Object.hasOwn(descriptor, 'value') && Number.isFinite(descriptor.value)
        ? descriptor.value : null;
    };
    state.callbackCount++;
    state.lastCallback = {mediaTime: number('mediaTime'),
      presentationTime: number('presentationTime'), presentedFrames: number('presentedFrames')};
  } catch { /* Diagnostic getters cannot affect presentation admission. */ }
}
function beginNativeFrame({videos, deadline, signal}) {
  if (nativeFrame) throw Error('HTML native frame fence is already active');
  if (!Number.isFinite(deadline) || deadline <= performance.now())
    throw Error('HTML native video frame deadline expired');
  signal?.throwIfAborted();
  for (const video of videos) {
    // Native audio prepare registers authored gain/mute state before forcing
    // the browser silent. Preserve that ordering; readiness is checked later.
    if (!(video instanceof HTMLVideoElement)) throw Error('Expected a video element');
    if (typeof video.requestVideoFrameCallback !== 'function' ||
        typeof video.cancelVideoFrameCallback !== 'function')
      throw Error('HTML native video requires requestVideoFrameCallback');
  }
  let rejectFailure;
  const failureWait = new Promise((_resolve, reject) => { rejectFailure = reject; });
  failureWait.catch(() => {});
  const scope = {deadline, signal, videos: [...videos], stage: 'begin-native-frame', states: new Map(), presentations: new Map(), jobs: new Set(), failed: false, closed: false, failure: undefined,
    failureWait, rejectFailure, timer: undefined, aborted: undefined};
  scope.aborted = () => failNativeFrame(scope, signal.reason ?? Error('HTML native video frame aborted'));
  scope.timer = setTimeout(() => failNativeFrame(scope, nativeTimeoutError(scope)),
    deadline - performance.now());
  signal?.addEventListener('abort', scope.aborted, {once: true});
  nativeFrame = scope;
  return scope;
}
function failNativeFrame(scope, error) {
  if (!scope.failed) { scope.failed = true; scope.failure = error; scope.rejectFailure(error); }
  for (const state of scope.states.values()) if (state.promise) state.finish(error);
}
function assertNativeFrame(scope = nativeFrame) {
  if (!scope || scope.closed || scope !== nativeFrame) throw Error('HTML native frame fence is closed or replaced');
  if (scope.failed) throw scope.failure;
  scope.signal?.throwIfAborted();
  if (performance.now() >= scope.deadline) throw Error('HTML native video frame deadline expired');
}
async function waitNativeFrame(operation, scope = nativeFrame) {
  assertNativeFrame(scope);
  const result = await Promise.race([operation, scope.failureWait]);
  assertNativeFrame(scope);
  return result;
}
function nativeSeek(video, seconds) {
  const scope = nativeFrame;
  if (!scope) throw Error('HTML native video seek requires an active frame fence');
  assertNativeFrame(scope);
  try {
    if (!Number.isFinite(seconds) || seconds < 0 || seconds >= video.duration)
      throw Error('HTML native video seek target is outside the source');
    scope.signal?.throwIfAborted();
    checkVideo(video, false);
    if (performance.now() >= scope.deadline) throw Error('HTML native video frame deadline expired');
  } catch (error) { failNativeFrame(scope, error); throw error; }
  const previous = scope.states.get(video);
  if (previous && !previous.ownsSource()) {
    const error = Error('HTML native video source changed during seek (sameSource false)');
    failNativeFrame(scope, error); throw error;
  }
  // Same native command may be issued repeatedly by renderSeek. Reuse only
  // this frame's pending command or a callback-proven paused presentation.
  if (previous?.target === seconds && video.currentTime === seconds &&
      !video.seeking && video.readyState >= 2 && video.paused && previous.presentation)
    return previous.promise ?? Promise.resolve(previous.presentation);
  if (previous?.target === seconds && previous.promise) return previous.promise;
  previous?.finish(undefined, true);
  let resolve, reject, callback, timer, assignmentStartedAt, finished = false, landed = false;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  const state = {target: seconds, promise, presentation: undefined, finish, ownsSource,
    callbackCount: 0, lastCallback: null,
    observe: () => ({target: seconds, landed, callbackCount: state.callbackCount,
      lastCallback: state.lastCallback, assignmentStartedAt: Number.isFinite(assignmentStartedAt) ? assignmentStartedAt : null,
      sameSource: ownsSource()})};
  const assignedSource = video.currentSrc || video.src;
  const assignedSrc = video.src, assignedSrcAttribute = video.getAttribute('src');
  const assignedSources = [...video.querySelectorAll('source')].map(element => ({element,
    src: element.src, attributes: ['src', 'type', 'media'].map(name => element.getAttribute(name))}));
  const ownsAssignedSource = assignedSrcAttribute !== null ? assignedSrc === assignedSource
    : assignedSources.some(source => source.src === assignedSource);
  function ownsSource() {
    const sources = [...video.querySelectorAll('source')];
    const stableMarkup = video.src === assignedSrc && video.getAttribute('src') === assignedSrcAttribute
      && sources.length === assignedSources.length && sources.every((element, index) => {
        const source = assignedSources[index];
        return element === source.element && element.src === source.src
          && ['src', 'type', 'media'].every((name, index) => element.getAttribute(name) === source.attributes[index]);
      });
    // load() may clear currentSrc without changing declared candidates. Empty
    // selection owns the original resource only while its markup stays frozen.
    return stableMarkup && ownsAssignedSource && (!video.currentSrc || video.currentSrc === assignedSource);
  }
  const badMedia = event => {
    const sameSource = ownsSource();
    const diagnostic = ' (event ' + event.type + ', mediaErrorCode ' + (video.error?.code ?? 'none')
      + ', readyState ' + video.readyState + ', networkState ' + video.networkState
      + ', sameSource ' + sameSource + ')';
    try {
      checkVideo(video, false);
      if (event.type === 'error') throw Error('HTML native video decode failed without MediaError');
      if (!sameSource) throw Error('HTML native video source changed during seek');
      // load() queues abort/emptied even for a healthy same-source reload.
      // Neither event proves a decode failure or a presented frame. Continue
      // waiting under the original deadline and unchanged presentation fence.
    } catch (error) { finish(Error(error.message + diagnostic)); }
  };
  const aborted = () => finish(scope.signal.reason ?? Error('HTML native video frame aborted'));
  const seeked = () => { landed = true; };
  function finish(error, superseded = false, presentation) {
    if (finished) return;
    finished = true;
    if (callback !== undefined) video.cancelVideoFrameCallback(callback);
    clearTimeout(timer);
    video.removeEventListener('seeked', seeked);
    for (const type of ['error', 'abort', 'emptied']) video.removeEventListener(type, badMedia);
    scope.signal?.removeEventListener('abort', aborted);
    state.promise = undefined;
    if (error !== undefined) {
      if (!scope.failed) { scope.failed = true; scope.failure = error; scope.rejectFailure(error); }
      reject(error);
    } else {
      state.presentation = superseded ? undefined : presentation;
      resolve(presentation);
    }
  }
  function arm() {
    if (finished) return;
    callback = video.requestVideoFrameCallback((_now, metadata) => {
      if (finished) return;
      callback = undefined;
      observeNativeCallback(state, metadata);
      try {
        checkVideo(video, false);
        scope.signal?.throwIfAborted();
        if (!landed || video.seeking || video.readyState < 2) { arm(); return; }
        if (!ownsSource()) throw Error('HTML native video source changed before presentation (sameSource false)');
        // The target is the upstream decoder command, never learned from pixels
        // or the browser cursor. mediaTime is evidence of presentation, not an
        // exact-frame oracle: source PTS/variable-frame-rate selection is native.
        if (video.currentTime !== seconds) throw Error('HTML native video seek target changed before presentation');
        if (!Number.isFinite(metadata.mediaTime) || metadata.mediaTime < 0)
          throw Error('HTML native video callback omitted presentation metadata');
        if (!Number.isFinite(metadata.presentationTime) || metadata.presentationTime < 0 ||
            !Number.isSafeInteger(metadata.presentedFrames) || metadata.presentedFrames < 0)
          throw Error('HTML native video callback omitted presentation ownership');
        const previousPresentation = scope.presentations.get(video);
        // A callback can be delivered after seeked yet describe a submission
        // from before this assignment. Cursor/seeked alone do not own it.
        if (metadata.presentationTime < assignmentStartedAt ||
            previousPresentation && metadata.presentedFrames <= previousPresentation.presentedFrames) {
          arm(); return;
        }
        const presentation = {target: seconds, mediaTime: metadata.mediaTime,
          presentationTime: metadata.presentationTime, presentedFrames: metadata.presentedFrames};
        scope.presentations.set(video, presentation);
        managedVideos.add(video);
        finish(undefined, false, presentation);
      } catch (error) { finish(error); }
    });
  }
  scope.states.set(video, state);
  scope.jobs.add(promise);
  // Observe asynchronous native failures even when upstream catches a setter
  // error or calls this synchronous patch point without awaiting its promise.
  void promise.then(() => scope.jobs.delete(promise), error => {
    scope.jobs.delete(promise);
    if (!scope.failed) { scope.failed = true; scope.failure = error; scope.rejectFailure(error); }
  });
  video.addEventListener('seeked', seeked);
  for (const type of ['error', 'abort', 'emptied']) video.addEventListener(type, badMedia);
  scope.signal?.addEventListener('abort', aborted, {once: true});
  timer = setTimeout(() => finish(nativeTimeoutError(scope)), scope.deadline - performance.now());
  try {
    arm(); // Must precede the native assignment, including paused/initial-zero seeks.
    assignmentStartedAt = performance.now();
    video.currentTime = seconds;
  } catch (error) { finish(error); }
  return promise;
}
async function drainNativeFrame(scope = nativeFrame) {
  assertNativeFrame(scope);
  while (scope.jobs.size) await Promise.all([...scope.jobs]);
  assertNativeFrame(scope);
}
function endNativeFrame(scope = nativeFrame) {
  if (!scope || scope.closed) return;
  scope.closed = true;
  if (nativeFrame === scope) nativeFrame = undefined;
  clearTimeout(scope.timer);
  scope.signal?.removeEventListener('abort', scope.aborted);
  failNativeFrame(scope, Error('HTML native video frame fence closed'));
}

const mediaPaint = () => new Promise(resolve => requestAnimationFrame(resolve));
function checkVideo(video, ready) {
  if (!(video instanceof HTMLVideoElement)) throw Error('Expected a video element');
  if (!video.muted) throw Error('HTML video must be explicitly muted; use Rocut audio tracks');
  if (video.autoplay || !video.paused) throw Error('HTML video must be paused, not wall-clock driven');
  // Before source selection, currentSrc is empty for <video><source> markup.
  // Validate every candidate, then validate the selected source on later checks.
  const sources = video.currentSrc ? [video.currentSrc] : video.src ? [video.src]
    : [...video.querySelectorAll('source')].map(source => source.src);
  if (!sources.length) throw Error('HTML video requires a declared inline MP4/WebM asset');
  for (const src of sources) {
    const match = /^data:video\/(mp4|webm);base64,([A-Za-z0-9+/]*={0,2})$/.exec(src);
    if (!match || !match[2]) throw Error('HTML video requires a declared inline MP4/WebM asset');
    if (!frame.videoLimits || match[2].length * 3 / 4 > frame.videoLimits.maxBytes + 2)
      throw Error('HTML video exceeds the Rust resource byte limit');
  }
  if (video.error) throw Error('HTML video decode failed (code ' + video.error.code + ')');
  if (video.readyState >= 1 && (!Number.isFinite(video.duration) || video.duration <= 0
      || video.videoWidth < 1 || video.videoHeight < 1
      || video.videoWidth > frame.videoLimits.maxDimension || video.videoHeight > frame.videoLimits.maxDimension))
    throw Error('HTML video metadata exceeds the Rust decode limits');
  if (ready && (!managedVideos.has(video) || video.readyState < 2 || video.seeking))
    throw Error('HTML video is not ready; use native Html5Video or await rocutMedia.seek');
}
function checkHtmlMedia(ready = false) {
  if (typeof nativeAudioAnalysis !== 'undefined' && nativeAudioAnalysis) {
    nativeAudioBridge.checkMedia(ready); return;
  }
  if (typeof nativeAudioHandled !== 'undefined' && nativeAudioHandled) nativeAudioBridge.checkMedia(ready);
  if (document.querySelector(typeof nativeAudioHandled !== 'undefined' && nativeAudioHandled
      ? 'iframe,object,embed,[data-composition-src]' : 'audio,iframe,object,embed,[data-composition-src]'))
    throw Error('HTML media and external sub-compositions require an asset adapter; use Rocut tracks');
  const videos = [...document.querySelectorAll('video')];
  if (videos.length && (!frame.videoLimits || videos.length > frame.videoLimits.maxElements))
    throw Error('HTML video element count exceeds the Rust decode limit');
  for (const video of videos) checkVideo(video, ready);
}
Object.defineProperty(window, 'rocutMedia', {value:Object.freeze({
  beginNativeFrame, nativeSeek, assertNativeFrame, drainNativeFrame, waitNativeFrame, endNativeFrame,
  registerNative(video) { if (video) managedVideos.add(video); },
  check: checkHtmlMedia,
  async settle(video) {
    const deadline = performance.now() + 8000;
    while (video.readyState < 2 || video.seeking) {
      checkVideo(video, false);
      if (performance.now() > deadline) throw Error('HTML native video decode timed out');
      await mediaPaint();
    }
    managedVideos.add(video);
    await mediaPaint(); await mediaPaint();
    checkVideo(video, true);
  },
  async metadata(video, signal) {
    const deadline = performance.now() + 8000;
    while (video.readyState < 1) {
      signal?.throwIfAborted();
      checkVideo(video, false);
      if (performance.now() > deadline) throw Error('HTML video metadata timed out');
      await mediaPaint();
    }
    signal?.throwIfAborted();
    checkVideo(video, false);
    return video.duration;
  },
  async seek(video, seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) throw Error('Video seek time must be finite and nonnegative');
    const deadline = performance.now() + 8000;
    const wait = async test => {
      while (!test()) {
        checkVideo(video, false);
        if (performance.now() > deadline) throw Error('HTML video seek timed out');
        await mediaPaint();
      }
    };
    await wait(() => video.readyState >= 2);
    checkVideo(video, false);
    if (seconds >= video.duration) throw Error('Video seek time must be before source end');
    if (Math.abs(video.currentTime - seconds) > 1e-7) {
      let displayed = false;
      const callback = video.requestVideoFrameCallback(() => { displayed = true; });
      try {
        video.currentTime = seconds;
        await wait(() => !video.seeking && displayed);
      } finally { video.cancelVideoFrameCallback(callback); }
    }
    managedVideos.add(video);
    await mediaPaint(); await mediaPaint();
    checkVideo(video, true);
  }
})});
`;
