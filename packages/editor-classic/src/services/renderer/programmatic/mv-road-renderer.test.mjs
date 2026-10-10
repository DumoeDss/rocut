import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { recorder } from "../../../../../../script/fixtures/mv-road-oracle-runtime.mjs";
const road = readFileSync(new URL("./mv-road-renderer.ts", import.meta.url), "utf8");
const recipe = readFileSync(new URL("./mv-recipe-renderer.ts", import.meta.url), "utf8");
const raw = source => source.match(/String.raw`([\s\S]*)`;\s*$/)[1];
const render = new Function(`${raw(road)}\n${raw(recipe)};return renderMvRecipeSteps;`)();
const nativePost = { profile: "road-original-gl-v1", required: true, mode: "tear" };
const frame = {
  version: 1, outputRoles: ["background", "foreground"], post: [],
  root: { kind: "road", role: "background", nativePost, data: { commands: [
    { kind: "surface", id: "fg", size: [1920, 1080] },
    { kind: "native", target: "fg", action: { kind: "fillStyle", style: { kind: "solid", color: [1, 0, 0, 1] } } },
    { kind: "native", target: "fg", action: { kind: "fillRect", rect: [2, 3, 10, 11] } },
    { kind: "foreground", surface: "fg" },
    { kind: "release", surface: "fg" },
  ] } },
};
test("public Road requires original post even when scene-only is requested", () => {
  const record = recorder();
  assert.throws(() => Array.from(render(record.make().getContext().canvas, frame,
    { nativePostMode: "scene-only" }, (w, h) => record.make(w, h))), /required original native post backend/);
  const wrong = structuredClone(frame); wrong.root.nativePost.required = false;
  assert.throws(() => Array.from(render(record.make().getContext().canvas, wrong,
    { referencePost: { applyRoad() {} } }, (w, h) => record.make(w, h))), /Rust original native post admission/);
});
test("Road foreground is independent and main receives exact required post once", () => {
  const record = recorder(), allocated = [], posts = [];
  const canvas = record.make(1920, 1080, "output");
  Array.from(render(canvas, frame, { referencePost: { applyRoad(ctx, post) { posts.push([ctx.canvas.label, post]); } } },
    (w, h) => { const c = record.make(w, h, `surface-${allocated.length}`); allocated.push(c); return c; }));
  assert.equal(posts.length, 1);
  assert.equal(posts[0][1], nativePost);
  assert.ok(record.calls.some(call => call.kind === "drawImage" && call.target === "surface-2" && call.args[0] === "surface-4"));
  assert.ok(allocated.every(c => c.width === 1 && c.height === 1));
});
