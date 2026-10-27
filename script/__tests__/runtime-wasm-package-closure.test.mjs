import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { assertRuntimeWasmPackageUnchanged, resolveRuntimeWasmPackage } from "../runtime-wasm-package-closure.mjs";

const scratch = process.env.ROCUT_PACK_CLOSURE_ROOT;
const options = { skip: !scratch && "Set an explicit isolated ROCUT_PACK_CLOSURE_ROOT" };
const names = ["opencut_wasm_sync.js", "opencut_wasm_bg.js", "opencut_wasm_bg.wasm"];
const sourcePackage = process.env.ROCUT_PACK_TEST_WASM_PACKAGE_DIR ??
	fileURLToPath(new URL("../../rust/wasm/pkg/", import.meta.url));

function fixture(mismatch) {
	assert(isAbsolute(scratch));
	const root = mkdtempSync(join(scratch, "closure-"));
	const canonical = join(root, "rust/wasm/pkg");
	const installed = join(root, "node_modules/opencut-wasm");
	mkdirSync(canonical, { recursive: true });
	mkdirSync(installed, { recursive: true });
	for (const name of names) {
		let bytes = readFileSync(join(sourcePackage, name));
		if (mismatch === name) bytes = name.endsWith(".wasm")
			? Buffer.from([0,97,115,109,1,0,0,0])
			: Buffer.from(bytes.toString("utf8") + "\nexport function stale(){wasm.missingPackExport();}\n");
		writeFileSync(join(canonical, name), bytes, { flag: "wx" });
		writeFileSync(join(installed, name), Buffer.from("stale installed package"), { flag: "wx" });
	}
	writeFileSync(join(canonical, "package.json"), JSON.stringify({ name:"opencut-wasm", type:"module",
		exports:{"./sync":{default:mismatch === "manifest" ? "./wrong.js" : "./opencut_wasm_sync.js"}} }), { flag:"wx" });
	return { repoRoot: root };
}

test("canonical package closure ignores stale installed dependency bytes", options, () => {
	const source = fixture();
	const closure = resolveRuntimeWasmPackage(source);
	assert.equal(closure.wasmSyncEntry, join(source.repoRoot,"rust/wasm/pkg",names[0]));
	assert.deepEqual(closure.files.map(file => file.name), names);
	assert(closure.files.every(file => file.bytes > 0 && /^[a-f0-9]{64}$/.test(file.sha256)));
});

test("incompatible canonical glue, binary or export map is rejected before packing", options, () => {
	for (const name of [names[1],names[2],"manifest"])
		assert.throws(() => resolveRuntimeWasmPackage(fixture(name)), /ABI missing|fixed.*sync/);
});

test("runtime pack closure rejects implicit source paths", () => {
	assert.throws(() => resolveRuntimeWasmPackage({ repoRoot: "." }), /explicit/);
	assert.throws(() => resolveRuntimeWasmPackage({ repoRoot: process.cwd(), wasmPackageDirectory: "relative" }), /absolute/);
});

test("packages without pinned font admission cannot pass the pack gate", options, () => {
	for (const name of [names[0], names[1]]) {
		const source = fixture();
		const entry = join(source.repoRoot, "rust/wasm/pkg", name);
		writeFileSync(entry, readFileSync(entry, "utf8").replaceAll("resolvePinnedTextFontJson", "missingPinnedFont"), "utf8");
		assert.throws(() => resolveRuntimeWasmPackage(source), /ABI missing.*(?:resolvePinnedTextFontJson|missingPinnedFont)/);
	}
});

test("explicit package supplies the entire closure independently of canonical bytes", options, () => {
	const source = fixture(names[2]);
	const good = fixture();
	const selected = join(source.repoRoot, "private-pkg");
	cpSync(join(good.repoRoot, "rust/wasm/pkg"), selected, { recursive: true });
	const closure = resolveRuntimeWasmPackage({ ...source, wasmPackageDirectory: selected });
	assert.equal(closure.selection, "explicit");
	assert.equal(closure.wasmSyncEntry, join(selected, names[0]));
	assert.equal(closure.wasmBinary, join(selected, names[2]));
	assertRuntimeWasmPackageUnchanged(closure);
	writeFileSync(join(selected, names[1]), "changed", "utf8");
	assert.throws(() => assertRuntimeWasmPackageUnchanged(closure), /changed/);
});

test("explicit missing or incompatible package never falls back to canonical", options, () => {
	const good = fixture();
	for (const name of [names[1], names[2], "manifest"]) {
		const bad = fixture(name);
		assert.throws(() => resolveRuntimeWasmPackage({ ...good,
			wasmPackageDirectory: join(bad.repoRoot, "rust/wasm/pkg") }), /ABI missing|fixed.*sync/);
	}
	const missing = fixture();
	unlinkSync(join(missing.repoRoot, "rust/wasm/pkg", names[0]));
	assert.throws(() => resolveRuntimeWasmPackage({ ...good,
		wasmPackageDirectory: join(missing.repoRoot, "rust/wasm/pkg") }), /ENOENT/);
});
