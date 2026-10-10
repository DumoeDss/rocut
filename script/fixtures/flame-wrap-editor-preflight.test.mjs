import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { validateFlameWrapEditorBuild } from "./flame-wrap-editor-preflight.mjs";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function fixture() {
	const root = await mkdtemp("C:/tmps/flame-wrap-preflight-cpu-");
	const pins = [];
	for (const name of ["opencut_wasm_bg.wasm", "frozen.txt", "text.txt"]) {
		const path = join(root, name),
			bytes = Buffer.from(`Small fake CPU-only ${name}`);
		await writeFile(path, bytes, { flag: "wx" });
		pins.push({ path, sha256: sha(bytes) });
	}
	const build = {
		ok: true,
		inputsUnchanged: true,
		wasmSha256: pins[0].sha256,
		frozen: [pins[1]],
		textModules: [pins[2]],
		extraActualReceiptField: { preserved: true },
	};
	build.textModules[0].originalPath = "E:/unread-original-source.ts";
	const path = join(root, "build.json");
	await writeFile(path, JSON.stringify(build), { flag: "wx" });
	return { root, path, build };
}
test("unchanged inputs pass and full original build metadata survives", async () => {
	const f = await fixture(),
		before = await readFile(f.path);
	const receipt = await validateFlameWrapEditorBuild(f.path, f.root);
	assert.equal(receipt.validation.ok, true);
	assert.deepEqual(receipt.build, f.build);
	assert.deepEqual(await readFile(f.path), before);
	assert.equal(receipt.validation.files.length, 2);
	assert.equal(receipt.validation.wasm.actual, f.build.wasmSha256);
});
test("collect all drift and missing paths with expected/actual, never repair pins", async () => {
	const f = await fixture();
	await writeFile(f.build.frozen[0].path, "changed");
	f.build.textModules.push({
		path: join(f.root, "missing.txt"),
		sha256: sha("missing"),
	});
	await writeFile(f.path, JSON.stringify(f.build));
	await assert.rejects(
		validateFlameWrapEditorBuild(f.path, f.root),
		(error) => {
			const issues = error.receipt.validation.issues;
			assert(
				issues.some(
					(i) =>
						i.path === f.build.frozen[0].path &&
						i.expected === f.build.frozen[0].sha256 &&
						i.actual === sha("changed"),
				),
			);
			assert(
				issues.some(
					(i) =>
						i.path.endsWith("missing.txt") &&
						i.expected === sha("missing") &&
						i.actual === null &&
						i.reason === "missing",
				),
			);
			assert.doesNotThrow(() => JSON.stringify(error.receipt));
			return true;
		},
	);
	assert.equal(
		JSON.parse(await readFile(f.path)).frozen[0].sha256,
		f.build.frozen[0].sha256,
	);
});
test("false build flags and malformed schema fail closed with serializable receipt", async () => {
	const f = await fixture();
	f.build.ok = false;
	f.build.inputsUnchanged = false;
	f.build.textModules = null;
	await writeFile(f.path, JSON.stringify(f.build));
	await assert.rejects(
		validateFlameWrapEditorBuild(f.path, f.root),
		(error) => {
			for (const path of [
				"build.ok",
				"build.inputsUnchanged",
				"build.textModules",
			])
				assert(error.receipt.validation.issues.some((i) => i.path === path));
			return error.code === "FLAME_WRAP_EDITOR_BUILD_PREFLIGHT";
		},
	);
});

test("same-buffer WASM hash rejects changed binary bytes", async () => {
	const f = await fixture();
	await writeFile(join(f.root, "opencut_wasm_bg.wasm"), "changed fake binary");
	await assert.rejects(
		validateFlameWrapEditorBuild(f.path, f.root),
		(error) => {
			assert.equal(
				error.receipt.validation.wasm.actual,
				sha("changed fake binary"),
			);
			assert.equal(error.receipt.validation.wasm.expected, f.build.wasmSha256);
			return error.receipt.validation.issues.some((i) =>
				i.path.endsWith("opencut_wasm_bg.wasm"),
			);
		},
	);
});

test("missing build receipt still produces a complete serializable failure", async () => {
	const f = await fixture(),
		missing = join(f.root, "missing-receipt.json");
	await assert.rejects(
		validateFlameWrapEditorBuild(missing, f.root),
		(error) => {
			assert.equal(error.receipt.build, null);
			assert(
				error.receipt.validation.issues.some(
					(i) => i.path === missing && i.actual === "ENOENT",
				),
			);
			assert.doesNotThrow(() => JSON.stringify(error.receipt));
			return true;
		},
	);
});
