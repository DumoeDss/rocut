import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sorted = (items) => [...items].sort((a, b) => a.id.localeCompare(b.id));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function flameWrapExportSnapshot(request) {
	return async () => {
		const context = await request("context");
		return {
			project: context.project,
			revision: context.revision,
			clips: sorted(await request("clips")),
			tracks: sorted(await request("tracks")),
			record: await request("record"),
		};
	};
}

export async function freezeFlameWrapExportState({
	projectFile,
	clip,
	snapshot,
	before,
	root,
}) {
	let bytes,
		previous,
		stableSince = Date.now();
	const deadline = Date.now() + 15000;
	while (true) {
		bytes = await readFile(projectFile);
		const hash = sha(bytes);
		if (hash !== previous) {
			previous = hash;
			stableSince = Date.now();
		}
		if (Date.now() - stableSince >= 1600) break;
		assert(Date.now() < deadline, "Persisted project never became quiet");
		await pause(100);
	}
	const quiet = await snapshot();
	assert.deepEqual(
		{ ...quiet, record: before.record },
		before,
		"Project graph/revision changed while freezing export baseline",
	);
	// SaveManager may settle metadata timestamps without changing the graph.
	before.record = quiet.record;
	const assetFiles = [];
	assert(
		clip.editing.programmatic.resources.length > 0,
		"No actual imported source resource",
	);
	for (const resource of clip.editing.programmatic.resources) {
		assert(
			/^programmatic-sha256-[a-f0-9]{64}$/.test(resource.attachmentKey),
			"Unsafe resource attachment key",
		);
		const bodyPath = join(
			dirname(projectFile),
			"attachments",
			resource.attachmentKey,
			"body.bin",
		);
		const metadataPath = join(
			dirname(projectFile),
			"attachments",
			resource.attachmentKey,
			"metadata.json",
		);
		const body = await readFile(bodyPath),
			metadataBytes = await readFile(metadataPath);
		assert.equal(body.length, resource.byteLength);
		assert.equal(sha(body), resource.sha256);
		assetFiles.push({
			bodyPath,
			metadataPath,
			sha256: sha(body),
			metadataSha256: sha(metadataBytes),
		});
	}
	const persisted = JSON.parse(bytes);
	assert.deepEqual(before.record, {
		record: persisted.record,
		summary: persisted.summary,
	});
	await writeFile(join(root, "flame-wrap-project-before-export.json"), bytes, {
		flag: "wx",
	});
	return { bytes, assetFiles };
}

export async function verifyFlameWrapExportState({
	snapshot,
	before,
	projectFile,
	bytes,
	assetFiles,
}) {
	assert.deepEqual(
		await snapshot(),
		before,
		"Export mutated project graph/revision/record",
	);
	assert(
		(await readFile(projectFile)).equals(bytes),
		"Export mutated persisted bytes",
	);
	for (const asset of assetFiles) {
		assert.equal(
			sha(await readFile(asset.bodyPath)),
			asset.sha256,
			"Export changed imported source bytes",
		);
		assert.equal(
			sha(await readFile(asset.metadataPath)),
			asset.metadataSha256,
			"Export changed attachment metadata bytes",
		);
	}
}
