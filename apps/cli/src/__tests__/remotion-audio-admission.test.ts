import { expect, test } from "bun:test";
import * as wasm from "opencut-wasm";
import { admitNativeAudioSources } from "../programmatic/remotion-audio-analysis";

test("audio IO admits only literal canonical bytes under the independent Rust policy", () => {
  const policy = JSON.parse(wasm.programmaticAudioPolicyJson());
  const one = "data:audio/wav;base64,AQID", video = "data:video/webm;base64,AQID";
  const result = admitNativeAudioSources(`${one} ${one} ${video} https://example.invalid/audio.wav file:///secret.mp3`, [], policy);
  expect(result).toHaveLength(2);
  expect(result[0].body).toEqual(Buffer.from([1, 2, 3]));
  expect(result[0].id).toMatch(/^[0-9a-f]{64}$/);
  expect(result[0].id).not.toBe(result[1].id); // MIME is part of content identity.
  expect(admitNativeAudioSources(one, [], policy)[0].id).toBe(result[0].id);
  expect(() => admitNativeAudioSources("data:audio/wav;base64,AR==", [], policy)).toThrow("canonical");
  expect(() => admitNativeAudioSources(one, [], { ...policy, maxSourceBytes: 2 })).toThrow("byte");
  expect(() => admitNativeAudioSources(`${one} ${video}`, [], { ...policy, maxTotalBytes: 5 })).toThrow("byte");
  expect(() => admitNativeAudioSources(`${one} ${video}`, [], { ...policy, maxSources: 1 })).toThrow("count");
});
