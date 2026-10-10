import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const compiled = ts.transpileModule(
  readFileSync(new URL("./mv-road-post-backend.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
const module = { exports: {} };
new Function("exports", "require", compiled)(module.exports, () => {
  throw Error("Road backend must not load realm-specific runtime imports");
});
const { createRoadPostBackend, MV_ROAD_POST_BACKEND_SOURCE } = module.exports;

test("Road backend carries the host allocator and cancellation owner into either realm", () => {
  const embedded = new Function(`${MV_ROAD_POST_BACKEND_SOURCE};return createRoadPostBackend;`)();
  for (const create of [createRoadPostBackend, embedded]) {
    const captured = [], ctx = {}, request = {};
    const owner = {
      createSurface() {}, releaseSurface() {}, check() {}, renderReferencePost() {},
      executeRoadPost(input) { captured.push(input); },
    };
    const backend = create(owner);
    assert.equal(Object.isFrozen(backend), true);
    backend.applyRoad(ctx, request);
    assert.deepEqual(captured, [{ ctx, request,
      createSurface: owner.createSurface, releaseSurface: owner.releaseSurface,
      check: owner.check, renderReferencePost: owner.renderReferencePost,
    }]);
  }
});
