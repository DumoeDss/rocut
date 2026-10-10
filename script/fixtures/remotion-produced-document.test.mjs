import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const text = readFileSync(new URL("../../apps/cli/src/programmatic/html-document.ts", import.meta.url), "utf8");
const source = text.match(/const BOOTSTRAP = String\.raw`([\s\S]*?)`;/)[1];

async function capture(author) {
  let ready;
  const replies = [], checks = [];
  const scan = { profile: "remotion-4.0.440-native-produced-frames-v1", frames: [{index:0}, {index:1}] };
  new Function("window", "document", "addEventListener", "parent", "resourcesReady", "frame", "audioAnalysis", "nativeAudioAnalysis", "checkHtmlMedia", "Math", source)(
    {rocut:author},
    {querySelectorAll:() => [], querySelector:() => null, body:{offsetHeight:1}, fonts:{ready:Promise.resolve()}},
    (name, handler) => { if (name === "DOMContentLoaded") ready = handler; },
    {postMessage:reply => replies.push(reply)}, Promise.resolve(), {seed:1},
    {engine:"remotion",remotionProduced:scan}, true, value => checks.push(value), Object.create(Math),
  );
  await ready();
  return {replies, checks, scan};
}

test("produced document calls its continuous author driver once without an extra frame-zero render", async () => {
  const seen = [], result = {version:1, frames:[{frameIndex:0, produced:[{id:"native"}]}]};
  const page = await capture({
    ready:Promise.resolve(),
    renderFrame() { throw Error("unexpected single frame"); },
    async renderProducedFrames(scan) { seen.push(scan); return result; },
  });
  assert.deepEqual(seen, [page.scan]);
  assert.deepEqual(page.checks, [undefined, true]);
  assert.deepEqual(page.replies, [{tag:"rocut-html-frame",ok:true,assets:result}]);
});

test("missing or rejected continuous driver produces an error, not empty successful assets", async () => {
  for (const author of [
    {renderFrame() {}},
    {renderFrame() {}, renderProducedFrames() { throw Error("native collection failed"); }},
  ]) {
    const page = await capture(author);
    assert.equal(page.replies.length, 1);
    assert.equal(page.replies[0].ok, undefined);
    assert.match(page.replies[0].error, /continuous-frame driver|native collection failed/);
  }
});
