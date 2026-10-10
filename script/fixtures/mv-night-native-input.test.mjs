import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { nightInputs } from "./mv-night-native-input.mjs";
test("actual project input requires explicit project authority and never falls back to dedicated artwork", async () => {
    await assert.rejects(nightInputs({ root: process.cwd(), referenceRoot: process.cwd(), mode: "actual-project-assets" }), /Explicit actual ROCUT_TEST_MV_PROJECT/);
});
test("dedicated mode requires explicit real pinned static700 bytes, not a relabelled800 font", async () => {
    await assert.rejects(nightInputs({ root: process.cwd(), referenceRoot: process.cwd(), mode: "dedicated-native-fixtures" }), /Explicit pinned ROCUT_TEST_MV_MINCHO700/);
    await assert.rejects(nightInputs({ root: process.cwd(), referenceRoot: process.cwd(), mode: "unknown-mode" }), /Assertion/);
});
test("browser gate includes original scene AND original GL full-frame pixels, mandatory15passes and honest artwork scope", () => {
    const source = readFileSync("script/fixtures/mv-night-native-browser.ts", "utf8");
    const runner = readFileSync("script/probe-mv-night-native.mjs", "utf8");
    assert.match(source, /compareTrainScenePixels\(/);
    assert.match(source, /compareReferencePostPixels\(/);
    assert.match(source, /originalTrainParameters\(/);
    assert.match(source, /parity\(\{ actual, expected: postResult\.originalRgba \}\)/);
    assert.match(source, /postPasses !== 15/);
    assert.match(source, /native-encoded dedicated fixtures/);
    assert.match(source, /timeline GL post excluded/);
    assert.match(runner, /private E:/);
    assert.match(runner, /result\.negativeCount >= 25/);
    assert.match(runner, /item\.postGatePassed, true/);
});
