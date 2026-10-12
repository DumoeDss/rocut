import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspace = fileURLToPath(new URL("../..", import.meta.url));
const root = await mkdtemp("C:/tmps/rocut-stylized-animation-compile-");
const pkg = "C:/tmps/rocut-svg-wasm-DHuXQ7/pkg";
const built = await Bun.build({ entrypoints: [join(workspace, "script/fixtures/stylized-object-animation-compile-worker.ts")], outdir: root, naming: "worker.mjs", target: "bun", plugins: [{name: "private-real-wasm", setup(builder) {builder.onResolve({filter: /^opencut-wasm$/}, () => ({path: join(pkg, "opencut_wasm_sync.js"), external: true}));}}] });
assert(built.success, built.logs.map(String).join("\n"));
const { run } = await import(pathToFileURL(join(root, "worker.mjs")).href);
await run({root, workspace});
console.log(JSON.stringify({root, receipt: join(root, "receipt.json")}));
