import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, writeFile, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
const repo = fileURLToPath(new URL("../..", import.meta.url));
const root = await mkdtemp("C:/tmps/rocut-animation-inspect-");
console.log(JSON.stringify({ root }));
const director = "E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/director";
const toolchain = join(root, "toolchain");
await cp("C:/tmps/rocut-three-pinned-features-ZvqmB9/toolchain", toolchain, { recursive: true, force: false, errorOnExist: true });
execFileSync(process.execPath, [join(director, "node_modules/typescript/bin/tsc"), "-p", join(director, "packages/three-assets/tsconfig.json"), "--outDir", join(toolchain, "node_modules/@elftia/three-assets/dist")], { windowsHide: true, timeout: 30000 });
const pkg = "C:/tmps/rocut-control-private-wasm-bftNN0/pkg";
for (const name of ["liquid-object-wasm.mjs", "particle-sampler-wasm.mjs", "liquid-object-worker-entry.mjs", "particle-sampler-worker-entry.mjs", "opencut_wasm_bg.wasm"])
  await copyFile(join("C:/tmps/rocut-control-integrated-AYnOOY/runtime", name), join(root, name));
const built = await Bun.build({ entrypoints: [join(repo, "script/fixtures/animation-inspect-http.ts")], outdir: root, naming: "acceptance.mjs", target: "bun",
  define: { "import.meta.__ROCUT_PACKED_LIQUID_OBJECT_MODULE_V1__": JSON.stringify("./liquid-object-wasm.mjs"), "import.meta.__ROCUT_PACKED_PARTICLE_SAMPLER_MODULE_V1__": JSON.stringify("./particle-sampler-wasm.mjs") },
  plugins: [{ name: "real-private-wasm", setup(builder) { builder.onResolve({ filter: /^opencut-wasm$/ }, () => ({ path: join(pkg, "opencut_wasm_sync.js"), external: true })); } }] });
assert(built.success, built.logs.map(String).join("\n"));
try { await (await import(pathToFileURL(join(root, "acceptance.mjs")).href)).runAnimationInspectHttp(root); console.log(JSON.stringify({ root, ok: true })); }
catch (error) { await writeFile(join(root, "failure.json"), JSON.stringify({ error: error instanceof Error ? error.stack : String(error) }, null, 2), { flag: "wx" }); throw error; }
