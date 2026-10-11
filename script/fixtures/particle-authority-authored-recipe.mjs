import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

const sourceReceipt = Object.freeze({
	path: "C:/tmps/rocut-stylized-f6XU4z/particle-c4-persistence-verification.json",
	sha256: "78749b7c402a2e564662b2af0ce6caf556d5041e5be66566d83926b5d98455b6",
});
const corroborationReceipt = Object.freeze({
	path: "C:/tmps/rocut-stylized-f6XU4z/particle-c3-consolidated-evidence.json",
	sha256: "c0be4e4961fff149a843afbbffa1e4c9504e176037286e8c9a1eed8c30c13d5c",
});
const pins = Object.freeze([
	Object.freeze({
		name: "particle-scene.ts",
		output: "author/particle-scene.ts",
		byteLength: 3948,
		sha256: "706c4074a25268587dcc861b4e04cc1e60f26159c540cced567141f4eb2c3488",
	}),
	Object.freeze({
		name: "particle-object.mjs",
		output: "particle-object.mjs",
		byteLength: 1835,
		sha256: "0809f6ceab847dcf1e51b4c7212c81b8c449e11ac19a15d1bed4b432cfd75b80",
	}),
]);

// Expectations come from independent retained receipts, never creator-root bytes.
// Their missing referenced run artifacts are not claimed to be authenticated.
export function readParticleAuthoredRecipe(creatorRoot) {
	assert.ok(isAbsolute(creatorRoot), "Explicit Creator root required");
	let directory = resolve(creatorRoot);
	for (const part of [
		"",
		"resources",
		"agent",
		"skills",
		"html-video",
		"assets",
		"rocut-stylized",
	]) {
		if (part) directory = join(directory, part);
		const stat = lstatSync(directory);
		assert.ok(
			stat.isDirectory() && !stat.isSymbolicLink(),
			"Creator recipe directory must be plain",
		);
	}
	const files = pins.map((pin) => {
		const path = join(directory, pin.name),
			stat = lstatSync(path);
		assert.ok(
			stat.isFile() && !stat.isSymbolicLink(),
			"Creator recipe source must be plain",
		);
		const bytes = readFileSync(path),
			sha256 = createHash("sha256").update(bytes).digest("hex");
		assert.equal(
			sha256,
			pin.sha256,
			"Creator recipe raw SHA mismatch: " + pin.name,
		);
		assert.equal(
			bytes.length,
			pin.byteLength,
			"Creator recipe byte length mismatch",
		);
		new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		return { ...pin, path, bytes };
	});
	return {
		files,
		contract: {
			schema: "particle-authored-recipe/v1",
			sourceReceipt,
			corroborationReceipt,
			expectedHashOverridesAllowed: false,
			referencedRunArtifactsAuthenticated: false,
			missingReferencedArtifacts: [
				"particle-c4-persistence-AGMhEa/evidence.json",
				"particle-c4-persistence-AGMhEa/source-manifest.json",
				"particle-c4-persistence-AGMhEa/source-stability.json",
				"particle-c4-persistence-AGMhEa/launcher-lifecycle.json",
				"particle-creator-template/template-evidence.json",
			],
			files: files.map(({ name, output, path, byteLength, sha256 }) => ({
				name,
				output,
				path,
				byteLength,
				sha256,
			})),
		},
	};
}
