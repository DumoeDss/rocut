import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, realpath } from "node:fs/promises";
import { join, dirname, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { validateFlameWrapEditorBuild } from "./flame-wrap-editor-preflight.mjs";

export function frostBuildModules(build) {
	const names = [
		"effect-fields.tsx",
		"frost-number-field.tsx",
		"frost-stroke-edit.ts",
		"frost-stroke-fields.tsx",
	];
	return names.map((name) => {
		const matches = build.textModules.filter((file) =>
			(file.originalPath ?? file.path)
				.replaceAll("\\", "/")
				.endsWith(`/${name}`),
		);
		assert.equal(matches.length, 1, `Frost build missing/ambiguous ${name}`);
		return matches[0];
	});
}

export async function preflightFrostEditor({
	pkg,
	buildReceipt,
	creator,
	entryFile,
}) {
	const { build, validation } = await validateFlameWrapEditorBuild(
		buildReceipt,
		pkg,
	);
	const frostModules = frostBuildModules(build);
	const emitted = await readFile(build.emittedWasm);
	assert.equal(
		createHash("sha256").update(emitted).digest("hex"),
		build.wasmSha256,
		"Emitted editor WASM drifted",
	);
	const dist = await realpath(build.editorDist),
		relative = win32.relative("C:/tmps", dist);
	assert(
		relative && !relative.startsWith("..") && !win32.isAbsolute(relative),
		"Editor dist is not private",
	);
	const artifactPins = [];
	const visit = async (directory) => {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			assert(!entry.isSymbolicLink(), "Editor artifact links are not admitted");
			const path = join(directory, entry.name);
			if (entry.isDirectory()) await visit(path);
			else if (entry.isFile()) {
				const bytes = await readFile(path);
				artifactPins.push({
					path,
					sha256: createHash("sha256").update(bytes).digest("hex"),
				});
				assert(
					artifactPins.length <= 10000,
					"Editor artifacts exceed fixture file bound",
				);
			}
		}
	};
	await visit(dist);
	const directory = dirname(fileURLToPath(import.meta.url));
	const names = [
		"frost-editor-state.mjs",
		"frost-editor-history.mjs",
		"frost-editor-checks.mjs",
		"frost-editor-project.mjs",
		"frost-editor-preflight.mjs",
		"frost-editor-export.mjs",
		"frost-editor-export-references.mjs",
		"frost-editor-export-decode.mjs",
		"flame-wrap-editor-export-state.mjs",
		"flame-wrap-export-metrics.mjs",
		"flame-wrap-editor-controls.mjs",
		"flame-wrap-editor-capture.mjs",
		"flame-wrap-presentation-observer.mjs",
		"flame-wrap-editor-browser.mjs",
		"flame-wrap-editor-request.mjs",
		"flame-wrap-editor-preflight.mjs",
		"blaze-editor-control.mjs",
		"blaze-editor-contract.mjs",
		"blaze-editor-lifecycle.mjs",
	];
	const pinned = [];
	for (const path of new Set([
		entryFile,
		creator,
		join(dirname(creator), "spatial.mjs"),
		buildReceipt,
		...names.map((name) => join(directory, name)),
	])) {
		const bytes = await readFile(path);
		new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		pinned.push({
			path,
			sha256: createHash("sha256").update(bytes).digest("hex"),
		});
	}
	return {
		build,
		validation,
		pinned: [...pinned, ...artifactPins],
		frostModules,
		scope:
			"Read-only same-buffer build/module and source pins; no browser/Host/GPU or current live-source equality claim",
	};
}

export async function assertFrostInputPins({ build, pinned }) {
	for (const file of [...pinned, ...build.frozen, ...build.textModules]) {
		assert.equal(
			createHash("sha256")
				.update(await readFile(file.path))
				.digest("hex"),
			file.sha256,
			file.path,
		);
	}
}
