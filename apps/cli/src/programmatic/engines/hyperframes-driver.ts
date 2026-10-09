import type { ProgrammaticSource } from "@opencut/editor-contracts";
import { ENGINE_VERSIONS } from "./engine-versions";

export const HYPERFRAMES_VERSION = ENGINE_VERSIONS.hyperframes;

/** Stable adapter bytes are included in the archive's toolchain fingerprint. */
export const HYPERFRAMES_FRAME_DRIVER = String.raw`(() => {
const rate = __ROCUT_FRAME_RATE__;
window.__HF_EXPORT_RENDER_SEEK_CONFIG = {fps: rate.numerator / rate.denominator, fpsSource: 'render-options'};
// Upstream waits fonts.ready before reactivating author scripts, but that does
// not load unused CSS faces. Start them first, before canvas/text measurements
// can be baked into a timeline using fallback metrics.
const ready = new Promise((resolve, reject) => {
  document.addEventListener('DOMContentLoaded', () => {
    let timer;
    try {
      void document.body?.offsetHeight;
      const loading = Promise.all([...document.fonts].map(face => face.load()));
      const timeout = new Promise((_, fail) => {
        // Fail before upstream's 5s soft fallback; never export that fallback.
        timer = setTimeout(() => fail(Error('HyperFrames font readiness timed out')), 4000);
      });
      Promise.race([loading, timeout]).then(resolve, reject).finally(() => clearTimeout(timer));
    } catch (error) { clearTimeout(timer); reject(error); }
  }, {once: true, capture: true});
});
// The capture bootstrap awaits this promise. Observe early rejection as well.
ready.catch(() => {});
window.rocut = {
  ready,
  async renderFrame(frame) {
    await ready;
    if (frame.frameRate.numerator !== rate.numerator || frame.frameRate.denominator !== rate.denominator)
      throw Error('HyperFrames bundle FPS differs from source; recompile the bundle');
    const deadline = performance.now() + 8000;
    const videos = [...document.querySelectorAll('video')];
    const nativeAudio = window.rocutHyperframesAudio;
    if (nativeAudio?.enabled) await nativeAudio.prepare();
    // Metadata must be real before native caches derive natural clip duration.
    // Every fresh capture starts from a decoded frame, including hidden clips.
    if (videos.length) {
      window.rocutMedia.check();
      await Promise.all(videos.map(async video => {
        await window.rocutMedia.metadata(video);
        await window.rocutMedia.seek(video, 0);
      }));
    }
    while (!window.__playerReady || !window.__renderReady) {
      if (performance.now() > deadline) throw Error('HyperFrames runtime readiness timed out');
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    const player = window.__player;
    if (typeof player?.renderSeek !== 'function' || typeof window.__hfWaitForSeekCompletion !== 'function')
      throw Error('Incompatible HyperFrames native runtime');
    const root = document.querySelector('[data-composition-id]');
    const id = root?.getAttribute('data-composition-id');
    // The upstream public __player intentionally does not expose _timeline.
    if (!id || typeof window.__timelines?.[id]?.totalTime !== 'function')
      throw Error('HyperFrames root timeline was not registered');
    player.pause();
    if (nativeAudio?.enabled) nativeAudio.begin(frame);
    player.renderSeek(frame.time, {exact: true, suppressEvents: false});
    await window.__hfWaitForSeekCompletion();
    // Upstream's media barrier has a soft timeout/error path. Do not treat its
    // completion alone as proof that the requested pictures were decoded.
    await Promise.all(videos.map(video => window.rocutMedia.settle(video)));
    if (videos.length && typeof window.__hfReseekGpu === 'function') {
      window.__hfReseekGpu(frame.time);
      await window.__hfWaitForSeekCompletion();
    }
    window.rocutMedia.check(true);
    if (player.isPlaying() || Math.abs(player.getTime() - frame.time) > 1e-7)
      throw Error('HyperFrames native runtime did not seek to the requested time');
  }
};
})();`;

/** Precedes upstream HTML so render config exists before native runtime boots. */
export function hyperframesFrameDriver(frameRate: ProgrammaticSource["frameRate"]): string {
	const rate = JSON.stringify(frameRate).replace(/</g, "\\u003c");
	return `<script>${HYPERFRAMES_FRAME_DRIVER.replace("__ROCUT_FRAME_RATE__", rate)}</script>`;
}
