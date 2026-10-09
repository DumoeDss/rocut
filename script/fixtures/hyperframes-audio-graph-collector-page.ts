import { HYPERFRAMES_AUDIO_GRAPH_BOOTSTRAP } from "../../apps/cli/src/programmatic/hyperframes-audio-graph-bootstrap";

/** Runs before upstream boot; admissions refer to the generated WAV bytes. */
export function collectorPageDriver(
	source: string,
	resourceId: string,
): string {
	const admission = JSON.stringify({ source, resourceId }).replace(
		/</g,
		"\\u003c",
	);
	return `<script>${HYPERFRAMES_AUDIO_GRAPH_BOOTSTRAP}
window.__HF_EXPORT_RENDER_SEEK_CONFIG = {fps:25,fpsSource:'render-options'};
document.addEventListener('DOMContentLoaded', () => {
  try {
    const admission = ${admission};
    window.__collectorRegistrations = [...document.querySelectorAll('audio,video')].map(el => {
      if ((el.currentSrc || el.src) !== admission.source) throw Error('Fixture source was not admitted');
      const authoredMuted = el.muted;
      window.rocutHyperframesAudioGraph.registerMedia(el, {resourceId:admission.resourceId,authoredMuted});
      el.muted = true;
      el.pause();
      const scene = el.closest('[data-probe-scene]');
      return {case:el.getAttribute('data-probe-case'),instanceId:el.getAttribute('data-hf-render-id'),
        authorId:el.id,authoredMuted,attributeMuted:el.hasAttribute('muted'),
        scene:scene?.getAttribute('data-probe-scene') ?? null,
        sceneAuthorId:scene?.id ?? null,
        sceneCompositionId:scene?.getAttribute('data-composition-id') ?? null,
        busId:scene?.querySelector('hf-audio-group')?.getAttribute('data-hf-render-id') ?? null};
    });
  } catch (error) { window.__collectorFailure = String(error); }
}, {once:true,capture:true});
</script>`;
}

export const COLLECTOR_READY = String.raw`(async () => {
  const deadline = performance.now() + 8000;
  while (!window.__playerReady || !window.__renderReady || !window.__collectorRegistrations) {
    if (window.__collectorFailure) throw Error(window.__collectorFailure);
    if (performance.now() > deadline) throw Error('Native collector fixture readiness timed out');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  const player = window.__player;
  if (typeof player?.renderSeek !== 'function' || typeof window.__hfWaitForSeekCompletion !== 'function')
    throw Error('Missing real native seek APIs');
  if (typeof window.__timelines?.root?.totalTime !== 'function') throw Error('Missing real root timeline');
  if (window.rocutHyperframesAudio !== undefined || window.rocutMedia !== undefined)
    throw Error('Collector probe must not install the gain-only or decoder bridges');
  player.pause();
  for (const el of document.querySelectorAll('audio,video')) {
    while (el.readyState < 1 || !Number.isFinite(el.duration) || el.duration <= 0) {
      if (el.error) throw Error('Fixture media failed to load: ' + el.error.code);
      if (performance.now() > deadline) throw Error('Real media metadata timed out');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    if (!el.muted || !el.paused) throw Error('Fixture media transport is not silent/paused');
  }
  return {registrations:window.__collectorRegistrations,
    metadata:[...document.querySelectorAll('audio,video')].map(el => ({instanceId:el.getAttribute('data-hf-render-id'),duration:el.duration})),
    runtimeReady:window.__playerReady,renderReady:window.__renderReady};
})()`;

/** Real preview playback is required: renderSeek intentionally stops all routes. */
export const COLLECTOR_ROUTED_GAIN = String.raw`(async () => {
  const player = window.__player;
  const deadline = performance.now() + 1500, samples = [];
  try {
    while (performance.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 20));
      const snapshot = window.rocutHyperframesAudioGraph.snapshot();
      const gain = snapshot.tracks.find(track => track.authorId === 'routed')?.resolvedAuthorGain;
      if (samples.length < 5) samples.push({time:player.getTime(),gain});
      if (gain?.state === 'observed' && gain.fallback?.routed) {
        if (!player.isPlaying()) throw Error('Native routed observation was not during playback');
        return snapshot;
      }
    }
    throw Error('Real native preview did not route the fixture audio: '+JSON.stringify({playing:player.isPlaying(),time:player.getTime(),samples}));
  } finally { player.pause(); }
})()`;

export const collectorSeek = (
	time: number,
	volumes: Record<string, number> = {},
): string => `(async () => {
  const time = ${JSON.stringify(time)}, player = window.__player;
  player.pause();
  for (const [id, volume] of Object.entries(${JSON.stringify(volumes)})) document.getElementById(id).volume = volume;
  window.rocutHyperframesAudioGraph.begin({time});
  player.renderSeek(time, {exact:true,suppressEvents:false});
  let timer;
  try {
    await Promise.race([window.__hfWaitForSeekCompletion(),new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('Real native seek timed out')), 8000);
    })]);
  } finally { clearTimeout(timer); }
  if (player.isPlaying() || Math.abs(player.getTime() - time) > 1e-7)
    throw Error('Real native player did not reach requested time');
  for (const el of document.querySelectorAll('audio,video'))
    if (!el.muted || !el.paused) throw Error('Fixture transport became audible/playing');
  return window.rocutHyperframesAudioGraph.snapshot();
})()`;
