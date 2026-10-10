import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareFlameWrapEditorInputs } from "./flame-wrap-editor-inputs.mjs";
const workspace = fileURLToPath(new URL("../../", import.meta.url));
const creator = resolve(
	workspace,
	"../../elftia/elftia-plugin-creator-studio/resources/agent/skills/html-video/assets/rocut-stylized/flame-wrap.mjs",
);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function fixture(name) {
	const root = await mkdtemp(`C:/tmps/flame-wrap-inputs-${name}-`);
	const options = {
		root,
		pkg: root,
		creator,
		buildReceipt: join(root, "build.json"),
		stage: "ui-only",
		workspace,
		entryFile: join(workspace, "script/probe-flame-wrap-editor.mjs"),
	};
	const bytes = Buffer.from("CPU-only fake WASM receipt fixture");
	await writeFile(join(root, "opencut_wasm_bg.wasm"), bytes, { flag: "wx" });
	const pinned = join(root, "input.bin");
	await writeFile(pinned, bytes, { flag: "wx" });
	const build = {
		ok: true,
		inputsUnchanged: true,
		wasmSha256: sha(bytes),
		frozen: [{ path: pinned, sha256: sha(bytes) }],
		textModules: [{ path: pinned, sha256: sha(bytes) }],
	};
	return { options, build, pinned };
}
test("missing receipt launches nothing and never overwrites evidence", async () => {
	const { options } = await fixture("missing");
	await assert.rejects(prepareFlameWrapEditorInputs(options), {
		code: "FLAME_WRAP_EDITOR_BUILD_PREFLIGHT",
	});
	const original = await readFile(join(options.root, "evidence.json"));
	const evidence = JSON.parse(original);
	assert.equal(evidence.browserRun, false);
	assert.equal(evidence.hostRun, false);
	await assert.rejects(
		prepareFlameWrapEditorInputs(options),
		(error) => error.evidenceWriteError?.code === "EEXIST",
	);
	assert.deepEqual(
		await readFile(join(options.root, "evidence.json")),
		original,
	);
});
test("drift preserves receipt and source without repairing pins", async () => {
	const { options, build, pinned } = await fixture("drift");
	await writeFile(options.buildReceipt, JSON.stringify(build), { flag: "wx" });
	const receipt = await readFile(options.buildReceipt);
	await writeFile(pinned, "changed CPU-only input");
	await assert.rejects(prepareFlameWrapEditorInputs(options), {
		code: "FLAME_WRAP_EDITOR_BUILD_PREFLIGHT",
	});
	const e = JSON.parse(await readFile(join(options.root, "evidence.json")));
	assert(
		e.preflight.validation.issues.some(
			(i) => i.path === pinned && i.actual === sha("changed CPU-only input"),
		),
	);
	assert.deepEqual(await readFile(options.buildReceipt), receipt);
	assert.equal(await readFile(pinned, "utf8"), "changed CPU-only input");
});
test("CPU-only admitted receipt retains owned helper/request/history/entry pins", async () => {
	const { options, build } = await fixture("table");
	await writeFile(options.buildReceipt, JSON.stringify(build), { flag: "wx" });
	const result = await prepareFlameWrapEditorInputs(options);
	assert.deepEqual(result.build, build);
	assert.equal(result.validation.ok, true);
	for (const suffix of [
		"flame-wrap-editor-inputs.mjs",
		"flame-wrap-editor-request.mjs",
		"blaze-editor-control.mjs",
		"probe-flame-wrap-editor.mjs",
	])
		assert(result.pinned.some((f) => f.path.endsWith(suffix)));
});

test("both export profiles freeze all extracted decoder/reference/state inputs", async () => {
	for (const stage of ["full", "full-444"]) {
		const { options, build } = await fixture(stage);
		options.stage = stage;
		await writeFile(options.buildReceipt, JSON.stringify(build), {
			flag: "wx",
		});
		const result = await prepareFlameWrapEditorInputs(options);
		for (const suffix of [
			"flame-wrap-editor-export-decode.mjs",
			"flame-wrap-editor-export-state.mjs",
			"flame-wrap-editor-export-references.mjs",
		])
			assert(result.pinned.some((file) => file.path.endsWith(suffix)));
	}
});
