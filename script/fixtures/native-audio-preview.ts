import type { EditorCore } from "../../packages/editor-classic/src/core";
import type { SceneTracks } from "../../packages/editor-classic/src/timeline/types";
import { AudioManager } from "../../packages/editor-classic/src/core/managers/audio-manager";
import { ProgrammaticAudioRuntime } from "../../packages/editor-classic/src/media/programmatic-audio-runtime";
import type { ProgrammaticSource } from "@opencut/editor-contracts";

function check(condition: unknown, message: string): asserts condition { if (!condition) throw Error(message); }
async function until(predicate: () => boolean) {
  const deadline = performance.now() + 3000;
  while (!predicate()) { if (performance.now() > deadline) throw Error("Audio preview condition timeout"); await new Promise(resolve => setTimeout(resolve, 10)); }
}

/** Real AudioManager + native Web Audio; only the editor shell and an IO gate
 * are fixtures. PCM comes from the already-verified real native host renderer.
 */
export async function verifyNativeAudioPreview({ tracks, source, cached }: {
  tracks: SceneTracks; source: ProgrammaticSource; cached: ProgrammaticAudioRuntime;
}) {
  const context = new AudioContext({ sampleRate: 44100 });
  const listeners = new Set<() => void>(), seeks = new Set<(ticks: number) => void>();
  const nodes: AudioBufferSourceNode[] = [], gains: GainNode[] = [];
  const createSource = context.createBufferSource.bind(context), createGain = context.createGain.bind(context);
  context.createBufferSource = () => { const node = createSource(); nodes.push(node); return node; };
  context.createGain = () => { const node = createGain(); gains.push(node); return node; };
  let release!: () => void, entered = false, playing = false, time = 0, closed = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const runtime = new ProgrammaticAudioRuntime({ async renderPng() { throw Error("Preview audio requested picture"); },
    async renderAudio({ signal }) { entered = true; await gate; signal.throwIfAborted();
      const result = await cached.load({ source, signal }); check(result, "Missing native soundtrack"); return result.data; },
  });
  const notify = () => { for (const listener of listeners) listener(); };
  const editor = {
    renderer: { programmaticAudio: runtime },
    resources: { createAudioContext: () => ({ context, close: async () => { closed++; await context.close(); } }),
      setInterval: ({ handler, ms }: { handler: () => void; ms: number }) => { const id = setInterval(handler, ms); return { cancel: () => clearInterval(id) }; } },
    playback: { getVolume: () => 1, getIsPlaying: () => playing, getCurrentTime: () => time,
      getIsScrubbing: () => false, subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
      onSeek: (listener: (ticks: number) => void) => { seeks.add(listener); return () => seeks.delete(listener); },
      pause: () => { playing = false; notify(); } },
    timeline: { subscribe: () => () => {}, getTotalDuration: () => 24000 },
    media: { subscribe: () => () => {}, getAssets: () => [] },
    scenes: { getActiveScene: () => ({ tracks: { ...tracks, audio: [] } }) },
  };
  const manager = new AudioManager(editor as unknown as EditorCore);
  try {
    await context.resume(); playing = true; notify(); await until(() => entered);
    const initial = context.currentTime; await until(() => context.currentTime > initial + 0.03);
    check(manager.getPlaybackClockTime() === 0, "Preview ran ahead while native PCM was pending");
    release(); await until(() => nodes.length === 1 && !!nodes[0].buffer);
    const buffer = nodes[0].buffer!;
    check(buffer.length === 5880, `Preview trim/duration mismatch: ${buffer.length}`);
    for (let i = 0; i < buffer.length; i++) for (let c = 0; c < 2; c++) {
      const expected = Math.fround(Math.sin((1470 + i) * 441 * Math.PI * 2 / 44100) * (c ? -0.2 : 0.4)) * 0.5;
      check(Math.abs(buffer.getChannelData(c)[i] - expected) < 1e-7, "Preview prepared a different source clock");
    }
    // The clip begins at 1/30s; scheduled AudioParam values aren't effective before then.
    await until(() => (manager.getPlaybackClockTime() ?? 0) > 0.04);
    check(Math.abs(gains[gains.length - 1].gain.value - 0.5011872336272722) < 1e-7,
      `Preview source gain was omitted or applied twice: ${gains[gains.length - 1].gain.value}`);
    editor.playback.pause(); check(manager.getPlaybackClockTime() === null, "Paused preview retained the audio clock");
    time = 8000; playing = true; notify(); await until(() => nodes.length === 2);
    check((manager.getPlaybackClockTime() ?? 0) >= 2 / 30, "Seeked preview restarted from source zero");
    editor.playback.pause();
    return { preparedSamples: buffer.length, scheduledSources: nodes.length, startupClockHeld: true, sourceGainAppliedOnce: true };
  } finally { await manager.dispose(); await runtime.invalidate(); check(closed === 1, "Preview context was not closed exactly once"); }
}
