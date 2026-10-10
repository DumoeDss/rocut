import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { assertBlazeHostRealPath } from "./blaze-host-paths.mjs";
import { assertBlazeEditorBytes } from "./blaze-editor-persistence.mjs";
import {
	blazeEditorDigest as digest,
	blazeEditorSnapshot,
} from "./blaze-editor-control.mjs";

export async function blazeEditorProjectFiles(root, prefix = "") {
	await assertBlazeHostRealPath(root);
	const files = [];
	for (const entry of await readdir(root, { withFileTypes: true })) {
		assert(
			!entry.isSymbolicLink(),
			"Private project contains a redirected entry",
		);
		const path = join(root, entry.name),
			relative = prefix + entry.name;
		if (entry.isDirectory())
			files.push(...(await blazeEditorProjectFiles(path, relative + "/")));
		else {
			assert(entry.isFile());
			const bytes = await readFile(path);
			files.push({
				path: relative,
				bytes: bytes.length,
				sha256: digest(bytes),
			});
		}
	}
	return files.sort((a, b) => a.path.localeCompare(b.path, "en"));
}
export function assertOnlyBlazeExportsAdded(before, after) {
	const old = new Map(before.map((file) => [file.path, file]));
	const current = new Map(after.map((file) => [file.path, file]));
	assert.equal(current.size, after.length);
	for (const [path, file] of old)
		assert.deepEqual(
			current.get(path),
			file,
			`Export changed existing ${path}`,
		);
	const added = after.filter((file) => !old.has(file.path));
	for (const file of added)
		assert(
			/^exports\/[a-zA-Z0-9_-]+\.webm$/.test(file.path),
			`Unexpected project write: ${file.path}`,
		);
	return added;
}
export async function freezeBlazeExportProject(root, request) {
	const bytes = await readFile(join(root, "project-final-ui.json"));
	assertBlazeEditorBytes(
		bytes,
		await readFile(join(root, "project/project.json")),
		"export-initial",
	);
	const snapshot = await blazeEditorSnapshot(request),
		context = await request("context");
	assert.equal(snapshot.revision, 31);
	const document = JSON.parse(bytes);
	assert.deepEqual(document.record.data.settings.fps, {
		numerator: 30,
		denominator: 1,
	});
	assert.deepEqual(document.record.data.settings.canvasSize, {
		width: 192,
		height: 128,
	});
	assert.deepEqual(document.record.data.settings.background, {
		type: "color",
		color: "#000000",
	});
	assert.deepEqual(await request("record"), {
		record: document.record,
		summary: document.summary,
	});
	return {
		bytes,
		snapshot,
		context,
		files: await blazeEditorProjectFiles(join(root, "project")),
	};
}
export async function verifyBlazeExportProject(root, request, baseline, stage) {
	const bytes = await readFile(join(root, "project/project.json"));
	const identity = assertBlazeEditorBytes(baseline.bytes, bytes, stage);
	assert.deepEqual(
		await blazeEditorSnapshot(request),
		baseline.snapshot,
		stage,
	);
	assert.deepEqual(await request("context"), baseline.context, stage);
	const document = JSON.parse(bytes);
	assert.deepEqual(await request("record"), {
		record: document.record,
		summary: document.summary,
	});
	const files = await blazeEditorProjectFiles(join(root, "project"));
	const added = assertOnlyBlazeExportsAdded(baseline.files, files);
	return { ...identity, revision: baseline.snapshot.revision, added, files };
}
