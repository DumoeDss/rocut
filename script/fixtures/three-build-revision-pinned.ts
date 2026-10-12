import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveRuntimeWasmPackage } from "../runtime-wasm-package-closure.mjs";

const workspace = fileURLToPath(new URL("../..", import.meta.url));
const pinnedRoot = "C:/tmps/rocut-three-pinned-features-ZvqmB9";
const previous = JSON.parse(await readFile(join(pinnedRoot, "closure-receipt.json"), "utf8"));
const toolchain = previous.toolchain;
const manifest = JSON.parse(await readFile(join(toolchain, "package.json"), "utf8"));
assert.equal(manifest.dependencies.three, "0.185.1");
assert.equal(manifest.dependencies.esbuild, "0.27.3");
const closure = resolveRuntimeWasmPackage({ repoRoot: workspace, wasmPackageDirectory: previous.pkg });
assert.equal(closure.files[2].sha256, "748c4ff5780b13a95816c6ef7ae36533b807e39952ccd4a108baa29308272363");
const root = await mkdtemp("C:/tmps/rocut-three-revision-");
const built = await Bun.build({ entrypoints: [join(workspace, "script/fixtures/three-build-revision-loop.ts")],
	outdir: root, naming: "revision.mjs", target: "bun", plugins: [{ name: "private-real-wasm",
		setup(builder) { builder.onResolve({ filter: /^opencut-wasm(?:\/sync)?$/ }, () => ({
			path: closure.wasmSyncEntry, external: true,
		})); } }] });
assert(built.success, built.logs.map(String).join("\n"));
const worker = await import(pathToFileURL(join(root, "revision.mjs")).href);
await worker.runThreeRevisionLoop({ root, toolchain });
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
await writeFile(join(root, "pinned-receipt.json"), JSON.stringify({ root, toolchain, wasmPackage: closure,
	toolchainManifestSha256: hash(await readFile(join(toolchain, "package.json"))),
	toolchainLockSha256: hash(await readFile(join(toolchain, "package-lock.json"))),
	workerSha256: hash(await readFile(join(root, "revision.mjs"))),
	dependencies: manifest.dependencies }, null, 2), { flag: "wx" });
console.log(JSON.stringify({ root, toolchain, passed: true, scope: "CPU compile/revise/archive-only rebuild" }));
