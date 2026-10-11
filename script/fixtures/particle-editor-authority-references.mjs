import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { captureParticleEditorFrame } from "./particle-editor-checks.mjs";
import {
	assertFrozenIntegerCanvas,
	prepareIntegerCanvasGeometry,
} from "./particle-editor-integer-geometry.mjs";
import { finalParticleReferences } from "./particle-editor-references.mjs";
import { seek } from "./stylized-fusion-checks.mjs";

export function linkParticleAuthorityReferences(references, directory) {
	assert.ok(directory === "authority-final-references");
	return {
		...references,
		samples: references.samples.map((sample) => ({
			...sample,
			visible: {
				...sample.visible,
				file: directory + "/" + sample.visible.file,
			},
			backing: sample.backing?.file
				? { ...sample.backing, file: directory + "/" + sample.backing.file }
				: sample.backing,
		})),
	};
}
export async function captureParticleAuthorityReferences({
	page,
	root,
	dimensions,
	frames,
	revision,
}) {
	const directory = "authority-final-references",
		output = join(root, directory);
	await mkdir(output);
	// Real selection followed by the unchanged no-hit clear gesture in the reference helper.
	await page
		.locator('[data-testid="timeline-clip"][data-element-id="particle-model"]')
		.click();
	const geometry = await prepareIntegerCanvasGeometry({
		page,
		root: output,
		dimensions,
	});
	const references = await finalParticleReferences({
		page,
		root: output,
		dimensions,
		revision,
		at: (frame) => seek(page, Math.floor(frame / 30), frame % 30),
		shot: async (name, frame) => {
			await assertFrozenIntegerCanvas({ page, ...geometry });
			const sample = await captureParticleEditorFrame(
				page,
				output,
				name,
				dimensions,
				frames,
				frame * 4000,
			);
			await assertFrozenIntegerCanvas({ page, ...geometry });
			const bytes = await readFile(join(output, name + ".png"));
			assert.equal(bytes.readUInt32BE(16), geometry.frozen.bounds.width);
			assert.equal(bytes.readUInt32BE(20), geometry.frozen.bounds.height);
			return sample;
		},
	});
	return {
		references: linkParticleAuthorityReferences(references, directory),
		geometry: geometry.frozen,
	};
}
