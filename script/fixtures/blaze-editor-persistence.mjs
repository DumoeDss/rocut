import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { blazeEditorContract as contract } from "./blaze-editor-contract.mjs";
import {
	blazeEditorDigest as digest,
	blazeEditorPoll,
	blazeEditorWrite,
} from "./blaze-editor-control.mjs";

const projectPath = (root) => join(root, "project/project.json");

export function blazeEditorFirstOpen(seed, opened) {
	const initial = seed.record.data,
		current = opened.record.data;
	assert.equal(
		initial.metadata.thumbnail,
		undefined,
		"First-open seed must not already contain a thumbnail",
	);
	assert.equal(
		initial.timelineViewState,
		undefined,
		"First-open seed must not already contain view state",
	);
	const thumbnail = current.metadata.thumbnail;
	assert(typeof thumbnail === "string" && thumbnail.length < 2 * 1024 * 1024);
	assert(thumbnail.startsWith("data:image/png;base64,"));
	const encoded = thumbnail.slice("data:image/png;base64,".length),
		png = Buffer.from(encoded, "base64");
	assert.equal(png.toString("base64"), encoded);
	assert(
		png.length >= 33 &&
			png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
	);
	assert.equal(png.readUInt32BE(8), 13);
	assert.equal(png.subarray(12, 16).toString("ascii"), "IHDR");
	assert.equal(png.readUInt32BE(16), contract.width);
	assert.equal(png.readUInt32BE(20), contract.height);
	const view = current.timelineViewState;
	assert(view && typeof view === "object" && !Array.isArray(view));
	assert.deepEqual(Object.keys(view).sort(), [
		"playheadTime",
		"scrollLeft",
		"zoomLevel",
	]);
	assert(Number.isFinite(view.zoomLevel) && view.zoomLevel > 0);
	assert.equal(view.scrollLeft, 0);
	assert.equal(view.playheadTime, 0);
	for (const value of [
		initial.metadata.updatedAt,
		current.metadata.updatedAt,
	]) {
		assert(typeof value === "string" && Number.isFinite(Date.parse(value)));
		assert.equal(new Date(value).toISOString(), value);
	}
	assert(
		Date.parse(current.metadata.updatedAt) >=
			Date.parse(initial.metadata.updatedAt),
	);
	assert.equal(seed.summary.updatedAt, initial.metadata.updatedAt);
	assert.equal(opened.summary.updatedAt, current.metadata.updatedAt);
	const normalized = structuredClone(opened);
	delete normalized.record.data.metadata.thumbnail;
	delete normalized.record.data.timelineViewState;
	normalized.record.data.metadata.updatedAt = initial.metadata.updatedAt;
	normalized.summary.updatedAt = seed.summary.updatedAt;
	assert.deepEqual(
		normalized,
		seed,
		"First open changed non-initialization project data",
	);
	return {
		thumbnail: {
			width: contract.width,
			height: contract.height,
			sha256: digest(png),
		},
		view: { ...view },
		seedUpdatedAt: initial.metadata.updatedAt,
		openedUpdatedAt: current.metadata.updatedAt,
	};
}

export function assertBlazeEditorBytes(baseline, current, stage) {
	assert(Buffer.isBuffer(baseline) && Buffer.isBuffer(current));
	assert(
		current.equals(baseline),
		`${stage}: complete project.json bytes changed; no metadata exemption after baseline`,
	);
	return { stage, byteIdentical: true, sha256: digest(current) };
}

export async function blazeEditorSaved(root, request, validate) {
	let previous,
		stableSince = Date.now();
	return blazeEditorPoll(async () => {
		const bytes = await readFile(projectPath(root)),
			document = JSON.parse(bytes);
		if (validate && !validate(document)) {
			stableSince = Date.now();
			return null;
		}
		const hash = digest(bytes);
		if (hash !== previous) {
			previous = hash;
			stableSince = Date.now();
		}
		if (Date.now() - stableSince < contract.quietMs) return null;
		const retained = await request("record"),
			afterRead = await readFile(projectPath(root));
		if (
			!afterRead.equals(bytes) ||
			!isDeepStrictEqual(retained, {
				record: document.record,
				summary: document.summary,
			})
		) {
			stableSince = Date.now();
			return null;
		}
		return bytes;
	});
}

export async function prepareBlazeEditorFirstOpen(root, request) {
	const seedBytes = await readFile(join(root, "project-before-ui.json")),
		seed = JSON.parse(seedBytes);
	const bytes = await blazeEditorSaved(root, request, (opened) => {
		if (
			!opened.record.data.metadata.thumbnail ||
			!opened.record.data.timelineViewState
		)
			return false;
		blazeEditorFirstOpen(seed, opened);
		return true;
	});
	const details = blazeEditorFirstOpen(seed, JSON.parse(bytes));
	await blazeEditorWrite(root, "project-after-first-open.json", bytes);
	return {
		initialSha256: digest(seedBytes),
		firstOpenSha256: digest(bytes),
		details,
		quietMs: contract.quietMs,
	};
}

export async function verifyBlazeEditorReadOnly(
	root,
	request,
	baseline,
	stage,
) {
	const started = Date.now();
	const bytes = await blazeEditorPoll(async () => {
		const current = await readFile(projectPath(root));
		assertBlazeEditorBytes(baseline, current, stage);
		return Date.now() - started >= contract.quietMs ? current : null;
	});
	const persisted = JSON.parse(bytes);
	assert.deepEqual(await request("record"), {
		record: persisted.record,
		summary: persisted.summary,
	});
	await blazeEditorWrite(root, `project-${stage}.json`, bytes);
	return assertBlazeEditorBytes(baseline, bytes, stage);
}
