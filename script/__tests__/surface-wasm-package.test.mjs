import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { assertDisjointPaths, resolveSurfaceWasmPackage, surfaceWasmPackagePlugin, verifySurfaceWasmPackage } from "../surface-wasm-package.mjs";
import * as surfaceHelpers from "../surface-wasm-package.mjs";

const scratch = process.env.ROCUT_PACK_CLOSURE_ROOT;
const options = { skip: !scratch && "Set an isolated ROCUT_PACK_CLOSURE_ROOT" };
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

test("isolated surface uses selected bundler closure and verifies emitted binary bytes", options, () => {
	const root = mkdtempSync(join(scratch, "surface-closure-"));
	const pkg = join(root, "pkg"), surface = join(root, "surface"), out = join(root, "runtime");
	cpSync(join(repoRoot, "rust/wasm/pkg"), pkg, { recursive: true });
	mkdirSync(join(surface, "assets"), { recursive: true });
	const closure = resolveSurfaceWasmPackage({ repoRoot, wasmPackageDirectory: pkg, outDir: surface });
	assert.equal(closure.wasmBundlerEntry, join(pkg, "opencut_wasm.js"));
	const binary = readFileSync(closure.wasmBinary);
	let receipt;
	surfaceWasmPackagePlugin(closure).generateBundle.call({ emitFile: value => { receipt = value; } }, {}, {
		core: { type: "asset", fileName: "assets/opencut_wasm_bg-fixed.wasm", source: binary },
	});
	writeFileSync(join(surface, receipt.fileName), receipt.source);
	writeFileSync(join(surface, "assets/opencut_wasm_bg-fixed.wasm"), binary);
	assert.equal(verifySurfaceWasmPackage({ surfaceDirectory: surface, outDir: out, wasmPackage: closure }).coreWasm.sha256,
		closure.files[2].sha256);
	writeFileSync(join(surface, "assets/opencut_wasm_bg-fixed.wasm"), Buffer.from([0,97,115,109,1,0,0,0]));
	assert.throws(() => verifySurfaceWasmPackage({ surfaceDirectory: surface, outDir: out, wasmPackage: closure }), /does not match/);
	assert.throws(() => surfaceWasmPackagePlugin(closure).generateBundle.call({ emitFile() {} }, {}, {}), /exactly once/);
	writeFileSync(join(pkg, "opencut_wasm.js"), "wrong");
	assert.throws(() => resolveSurfaceWasmPackage({ repoRoot, wasmPackageDirectory: pkg, outDir: surface }), /bundler closure/);
});

test("surface paths reject relative inputs and input/output overlap before writes", () => {
	assert.throws(() => assertDisjointPaths("relative", repoRoot), /absolute/);
	assert.throws(() => assertDisjointPaths(repoRoot, join(repoRoot, "dist")), /overlap/);
});

test("manifest output cannot overwrite either explicit input directory", options, () => {
	const root = mkdtempSync(join(scratch, "manifest-input-"));
	const pkg = join(root, "pkg"), surface = join(root, "surface");
	mkdirSync(pkg); mkdirSync(surface);
	for (const manifestPath of [join(pkg, "package.json"), join(surface, "surface-wasm-package.json"), pkg])
		assert.throws(() => surfaceHelpers.assertRuntimeManifestOutsideInputs({
			manifestPath, wasmPackageDirectory: pkg, surfaceDirectory: surface,
		}), /overlap/);
	assert.doesNotThrow(() => surfaceHelpers.assertRuntimeManifestOutsideInputs({
		manifestPath: join(root, "receipt.json"), wasmPackageDirectory: pkg, surfaceDirectory: surface,
	}));
});
