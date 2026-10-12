import test from "node:test";
import assert from "node:assert/strict";
import { classifyFiniteBlaze } from "./audit-blaze-finite-scope.mjs";
const complete = { authorArtifactsVerified: true, videoArtifactsVerified: true, nativePngVerified: true, historicalCanvasRedPreserved: true, missingLineagePreserved: true };
test("PNG alone cannot establish finite author/video V", () => {
  const result = classifyFiniteBlaze({ ...complete, authorArtifactsVerified: false, videoArtifactsVerified: false });
  assert.equal(result.finiteEffectVEligible, false);
  assert.equal(result.nativePngSubsetAccepted, true);
  assert.equal(result.videoMasterRepairProven, false);
});
for (const key of ["authorArtifactsVerified", "videoArtifactsVerified"])
  test(`missing ${key} refuses V`, () => assert.equal(classifyFiniteBlaze({ ...complete, [key]: false }).finiteEffectVEligible, false));
for (const key of ["historicalCanvasRedPreserved", "missingLineagePreserved"])
  test(`erasing ${key} rejects the audit`, () => assert.throws(() => classifyFiniteBlaze({ ...complete, [key]: false })));
test("bounded archival author/video acceptance is not a video master repair", () => {
  const result = classifyFiniteBlaze(complete);
  assert.equal(result.finiteEffectVEligible, true);
  assert.equal(result.videoMasterRepairProven, false);
});
