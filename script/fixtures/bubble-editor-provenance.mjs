import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateBubbleExportInputs } from "../probe-bubble-export.mjs";
import { bubbleExportHash as hash } from "./bubble-export-preflight.mjs";

export async function validateBubbleEditorInputs(configPath, ownPath) {
	const result = await validateBubbleExportInputs(configPath);
	assert.equal(
		resolve(ownPath).toLowerCase(),
		resolve(
			result.config.snapshot,
			"script/probe-bubble-editor.mjs",
		).toLowerCase(),
		"Run the UI fixture from its frozen derived source",
	);
	const visit = async (file) => {
		file = resolve(file);
		if (result.inputs.has(file)) return;
		const bytes = await readFile(file),
			text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		result.inputs.set(file, hash(bytes));
		for (const match of text.matchAll(
			/(?:from\s*|import\s*)["'](\.[^"']+)["']/g,
		))
			await visit(resolve(dirname(file), match[1]));
	};
	await visit(ownPath);
	await visit(
		fileURLToPath(new URL("./bubble-editor-host.mjs", import.meta.url)),
	);
	assert(/^c:[/\\]tmps(?:[/\\]|$)/i.test(result.config.artifactParent));
	result.provenance.uiFixtureFiles = [...result.inputs]
		.filter(([file]) => /bubble-editor|probe-bubble-editor/.test(file))
		.map(([path, sha256]) => ({ path, sha256 }));
	return result;
}
export async function verifyBubbleEditorInputs(inputs) {
	for (const [path, expected] of inputs)
		assert.equal(
			hash(await readFile(path)),
			expected,
			`UI input changed: ${path}`,
		);
}
