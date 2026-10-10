import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const text = readFileSync(new URL("../../packages/editor-classic/src/services/renderer/programmatic/mv-recipe-renderer.ts", import.meta.url), "utf8");
const source = text.match(/String\.raw`([\s\S]*)`;\s*$/)[1];

function fixture(failReplay = false) {
  const surfaces = [], received = [];
  const make = (width, height) => {
    const canvas = { width, height, paints: [] };
    const ctx = {
      fillStyle: null,
      fillRect() { canvas.paints.push(this.fillStyle); },
      drawImage(other) { canvas.paints.push(...other.paints); },
    };
    canvas.getContext = () => ctx;
    surfaces.push(canvas);
    return canvas;
  };
  const panels = (_ctx, _data, child) => {
    received.push(child(0, "background"), child(0, "foreground"), child(1, "background"));
    if (failReplay) throw Error("replay rejected");
  };
  const render = new Function("mvMetaPanels", `${source};return renderMvRecipe;`)(panels);
  const output = make(1920, 1080);
  const plan = {
    version: 1, outputRoles: ["graphics"], post: [],
    root: { kind: "panelsNative", role: "graphics", data: {}, inputs: [
      { kind: "solid", role: "background", color: [1, 0, 0, 1] }, null,
    ] },
  };
  return { surfaces, received, run: () => render(output, plan, {}, make) };
}

test("Panels root passes separate background and subject/graphics/foreground phases", () => {
  const f = fixture();
  f.run();
  assert.deepEqual(f.received[0].paints, ["rgba(255,0,0,1)"]);
  assert.deepEqual(f.received[1].paints, []);
  assert.equal(f.received[2], undefined);
  assert.notEqual(f.received[0], f.received[1]);
  assert.ok(f.surfaces.slice(1).every(c => c.width === 1 && c.height === 1));
});

test("Panels replay failure releases both phases and intermediate role surfaces", () => {
  const f = fixture(true);
  assert.throws(f.run, /replay rejected/);
  assert.ok(f.surfaces.slice(1).every(c => c.width === 1 && c.height === 1));
});
