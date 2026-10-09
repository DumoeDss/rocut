/** Browser IO/readiness only. Engine timing belongs to the native adapter;
 * resource/decoder policy comes from the Rust-resolved frame, never author code.
 * This is not an audio renderer: audible media must not silently disappear.
 */
export const HTML_MEDIA_BOOTSTRAP = String.raw`
const managedVideos = new WeakSet();
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
