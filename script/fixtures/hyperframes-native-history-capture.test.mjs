import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const text = readFileSync(new URL("../../apps/cli/src/programmatic/hyperframes-native-history-capture.ts", import.meta.url), "utf8");
const source = text.match(/String\.raw`([\s\S]*)`;\s*$/)[1];

function fixture(observationTimes = [0.05, 0.1]) {
  const frames = [0, 0.05, 0.1].map((time, index) => ({ index, time, sourceTime: time * 120000, seed: 77, frameRate: {numerator: 30, denominator: 1} }));
  const events = [], rendered = [];
  const config = { engine: "hyperframes", hyperframesGraph: true, hyperframesNativeHistory: {
    scan: { profile: "hyperframes-native-sync-all-author-writes-v1", canonicalStart: 0, canonicalEnd: 0.1, times: frames.map(f => f.time), frames }, observationTimes,
  } };
  const graph = {
    beginNativeHistory(scan) { events.push(["begin", scan]); },
    endNativeHistory() { events.push(["end"]); return [{ events: ["native-write", "same-clock-write"] }]; },
  };
  const bridge = { snapshot() { return { time: rendered.at(-1).time }; } };
  const capture = new Function("audioAnalysis", "window", "nativeAudioBridge", "checkHtmlMedia", "failures", `${source};return captureHyperframesNativeHistory;`)(
    config, {rocutHyperframesAudioGraph: graph}, bridge, () => {}, [],
  );
  const author = { async renderFrame(frame) { events.push(["render", frame.time]); rendered.push(frame); } };
  return {capture, author, frames, events, rendered};
}

test("one continuous authored realm consumes complete Rust frame objects before sparse snapshots", async () => {
  const f = fixture(), random = () => 0.25;
  const result = await f.capture(f.author, random);
  assert.deepEqual(f.events.map(e => e[0]), ["begin", "render", "render", "render", "end"]);
  assert.deepEqual(f.rendered, f.frames.map(frame => ({...frame, random})));
  assert.deepEqual(result.observations, [{time:0.05}, {time:0.1}]);
  assert.deepEqual(result.fallbackHistories, [{events:["native-write", "same-clock-write"]}]);
});

test("missing discovery instant and rejected native driver do not yield successful histories", async () => {
  const missing = fixture([0.075]);
  await assert.rejects(missing.capture(missing.author, () => 0), /omitted a discovery observation/);
  const rejected = fixture();
  rejected.author.renderFrame = async () => { throw Error("native callback failed"); };
  await assert.rejects(rejected.capture(rejected.author, () => 0), /native callback failed/);
  assert.deepEqual(rejected.events.map(e => e[0]), ["begin"]);
});
