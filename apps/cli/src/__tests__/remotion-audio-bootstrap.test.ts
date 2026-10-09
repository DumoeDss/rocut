import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { REMOTION_AUDIO_BOOTSTRAP } from "../programmatic/remotion-audio-bootstrap";

interface Registry {
  enabled: boolean; analysisOnly: boolean; register(asset: Record<string, unknown>): void; unregister(id: string): void;
  snapshot(): Record<string, unknown>[]; checkMedia(): void;
}
function fixture(enabled = true, mode: "analysis" | "picture" = "analysis") {
  const window: { rocutRemotionAudio?: Registry } = {};
  runInNewContext(REMOTION_AUDIO_BOOTSTRAP, { window,
    audioAnalysis: enabled ? { mode, sources: [{ id: "declared", src: "data:audio/wav;base64,AQID" }],
      limits: { maxSeconds: 86400, maxAssetsPerFrame: 2 } } : null,
    document: { querySelector: () => null, querySelectorAll: () => [] },
  });
  const asset = { id: "native", type: "audio", src: "data:audio/wav;base64,AQID", frame: 23,
    mediaFrame: 24, audioStartFrame: 6, playbackRate: 2, volume: 0.28 };
  return { registry: window.rocutRemotionAudio!, window, asset };
}

test("native registry preserves native observations, unregisters effects, and does not return source bytes", () => {
  const { registry, asset } = fixture();
  registry.register(asset);
  expect(registry.snapshot()).toEqual([{ id: "native", type: "audio", resourceId: "declared",
    frame: 23, mediaFrame: 24, audioStartFrame: 6, playbackRate: 2, volume: 0.28,
    toneFrequency: 1, audioStreamIndex: 0 }]);
  registry.unregister("native"); expect(registry.snapshot()).toEqual([]);
  registry.register({ ...asset, playbackRate: undefined });
  expect(registry.snapshot()[0].playbackRate).toBe(1);
});

test("handled picture admits native registration but cannot masquerade as analysis", () => {
  const { registry, asset } = fixture(true, "picture");
  expect(registry.enabled).toBe(true); expect(registry.analysisOnly).toBe(false);
  registry.register(asset); registry.checkMedia();
  expect(() => registry.snapshot()).toThrow("not requested");
  const failed = fixture(true, "picture");
  expect(() => failed.registry.register({ ...failed.asset, src: "file:///undeclared" })).toThrow("not admitted");
  expect(() => failed.registry.checkMedia()).toThrow("not admitted");
});

test("normal picture mode cannot be switched to audio analysis by author code", () => {
  const { registry, window, asset } = fixture(false);
  expect(registry.enabled).toBe(false);
  expect(Object.isFrozen(registry)).toBe(true);
  expect(Object.getOwnPropertyDescriptor(window, "rocutRemotionAudio")?.configurable).toBe(false);
  expect(Object.getOwnPropertyDescriptor(window, "rocutRemotionAudio")?.writable).toBe(false);
  expect(() => registry.register(asset)).toThrow("mixing integration");
  expect(() => registry.snapshot()).toThrow();
});

test("unadmitted media, artifacts and count excess stay failed even if authored code swallows registration errors", () => {
  for (const changed of [{ src: "file:///secret.wav" }, { type: "artifact" }, { type: "inline-audio" }, { id: "x".repeat(257) }]) {
    const { registry, asset } = fixture();
    expect(() => registry.register({ ...asset, ...changed })).toThrow();
    registry.unregister("native");
    expect(() => registry.snapshot()).toThrow(); expect(() => registry.checkMedia()).toThrow();
  }
  const { registry, asset } = fixture();
  registry.register(asset); registry.register({ ...asset, id: "two" });
  expect(() => registry.register({ ...asset, id: "three" })).toThrow("count");
  registry.unregister("three"); expect(() => registry.snapshot()).toThrow("count");
});
