import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const text = readFileSync(new URL("../../apps/cli/src/programmatic/hyperframes-audio-graph-bootstrap.ts", import.meta.url), "utf8");
const source = text.match(/String\.raw`([\s\S]*)`;\s*$/)[1];

test("startup native sync before the requested frame does not poison an active history", () => {
  const window = {};
  new Function("window", "HTMLMediaElement", source)(window, class {});
  const graph = window.rocutHyperframesAudioGraph;
  graph.beginNativeHistory({
    profile: "hyperframes-native-sync-all-author-writes-v1",
    canonicalStart: 0, canonicalEnd: 1, times: [0, 1], frames: [{time:0}, {time:1}],
  });
  graph.collectTrack(null, null, 0);
  graph.collectResolvedAuthorGain(null, null, 0, null);
  graph.collectAppliedAuthorGain(null, null, 0, 1, 1);
  graph.begin({time:0});
  graph.begin({time:1});
  assert.deepEqual(graph.endNativeHistory(), []);
});
