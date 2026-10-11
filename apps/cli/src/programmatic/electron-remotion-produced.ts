import type { ResolvedProgrammaticResource } from "@opencut/editor-contracts";
import { openElectronAudioSession } from "./electron-audio-session";
import { createElectronNativeVideoServer } from "./electron-native-video-server";
import { createElectronRemotionProducedServer } from "./electron-remotion-produced-server";
import { htmlAudioAnalysisExpression } from "./html-document";
import type { NativeAudioAnalysisConfig } from "./remotion-audio-bootstrap";
import type { NativeAudioSource, NativeAudioObservation } from "./remotion-audio-analysis";
import type { NativeVideoDecoder } from "./video-decoder";

/** Exactly one from-zero scan in one Host-owned paused source realm. */
export async function collectElectronRemotionProducedFrames({ connectionFile, width, height, durationFrames,
  code, resources, sources, limits, scan, decoder, normalize, signal, openSession = openElectronAudioSession }: {
  connectionFile: string; width: number; height: number; durationFrames: number; code: string;
  resources: readonly ResolvedProgrammaticResource[]; sources: NativeAudioSource[];
  limits: NativeAudioAnalysisConfig["limits"] & { maxSourceBytes: number; maxTotalBytes: number };
  scan: NonNullable<NativeAudioAnalysisConfig["remotionProduced"]>;
  decoder?: NativeVideoDecoder;
  normalize: (frameIndex: number, assets: unknown) => NativeAudioObservation[];
  signal: AbortSignal; openSession?: typeof openElectronAudioSession;
}) {
  signal.throwIfAborted();
  if (!scan.frames.length || scan.frames.length !== durationFrames) throw Error("Incomplete canonical produced scan");
  const controller = new AbortController();
  const lifetime = AbortSignal.any([signal, controller.signal]);
  let capture: Awaited<ReturnType<typeof createElectronRemotionProducedServer>> | undefined;
  let video: Awaited<ReturnType<typeof createElectronNativeVideoServer>> | undefined;
  let session: Awaited<ReturnType<typeof openElectronAudioSession>> | undefined;
  try {
    const admittedSourceBytes = sources.reduce((sum, item) => sum + item.body.length, 0);
    capture = await createElectronRemotionProducedServer({ durationFrames,
      limits: { maxSourceBytes: limits.maxSourceBytes, maxTotalBytes: limits.maxTotalBytes - admittedSourceBytes }, signal: lifetime });
    const needsVideo = sources.some(item => item.mimeType.startsWith("video/"));
    if (needsVideo) {
      const videoLimits = scan.frames[0]?.videoLimits as { maxBytes: number; maxDimension: number; maxElements: number } | undefined;
      if (!decoder || !videoLimits) throw Error("Electron produced video sources require the native decoder");
      video = await createElectronNativeVideoServer({ decoder, code, resources, signal: lifetime,
        limits: { ...videoLimits, maxElements: scan.frames.length * videoLimits.maxElements } });
    }
    session = await openSession({ connectionFile, profile: "source", width, height, signal: lifetime,
      producedCapture: capture.callback, ...(video ? { nativeVideo: video.callback } : {}) });
    const raw = await session.evaluate(htmlAudioAnalysisExpression(code, scan.frames[0], resources, {
      limits, engine: "remotion", sources: sources.map(({ id, src }) => ({ id, src })), remotionProduced: scan,
    }, !!video), { timeoutMs: Math.min(1_800_000, 30_000 + scan.frames.length * 8000) }) as {
      version?: unknown; profile?: unknown; frames?: { frameIndex: number; assets: unknown; produced: unknown[] }[];
    } | undefined;
    await capture.check(); await video?.check(); lifetime.throwIfAborted();
    if (raw?.version !== 1 || raw.profile !== scan.profile || !Array.isArray(raw.frames)
      || raw.frames.length !== scan.frames.length) throw Error("Incomplete native produced scan");
    const frames = raw.frames.map((item, index) => {
      if (!item || item.frameIndex !== index || !Array.isArray(item.produced)) throw Error("Native produced scan clock changed");
      return { frameIndex: index, assets: normalize(index, item.assets), produced: item.produced };
    });
    return { frames, pictures: capture.take() };
  } finally {
    // Cancel pending evaluation/callback work before releasing the private realm.
    controller.abort();
    try { await session?.close(); }
    finally { try { await video?.dispose(); } finally { await capture?.dispose(); } }
  }
}
