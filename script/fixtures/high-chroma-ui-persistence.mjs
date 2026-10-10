import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { poll } from "./stylized-fusion-checks.mjs";
import { highChromaUiContract as contract } from "./high-chroma-ui-contract.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const quietMs = 1600;
const projectPath = (artifacts) => join(artifacts, "project/project.json");
const bounded = (value) =>
	typeof value === "string" && value.length > 200
		? { length: value.length, sha256: digest(value) }
		: value;

function differences(before, after, pointer = "") {
	if (isDeepStrictEqual(before, after)) return [];
	if (
		before &&
		after &&
		typeof before === "object" &&
		typeof after === "object" &&
		Array.isArray(before) === Array.isArray(after)
	) {
		return [...new Set([...Object.keys(before), ...Object.keys(after)])]
			.sort()
			.flatMap((key) =>
				differences(
					before[key],
					after[key],
					`${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`,
				),
			);
	}
	return [{ pointer, before: bounded(before), after: bounded(after) }];
}

/** Only the new seed's first normal editor-open metadata is permitted here. */
export function validateHighChromaUiFirstOpen(seed, opened) {
	const initial = seed.record.data;
	const current = opened.record.data;
	assert.equal(
		initial.metadata.thumbnail,
		undefined,
		"Seed already has a thumbnail",
	);
	assert.equal(
		initial.timelineViewState,
		undefined,
		"Seed already has a timeline view",
	);
	const thumbnail = current.metadata.thumbnail;
	assert(typeof thumbnail === "string" && thumbnail.length < 2 * 1024 * 1024);
	assert(thumbnail.startsWith("data:image/png;base64,"));
	const encoded = thumbnail.slice("data:image/png;base64,".length);
	const png = Buffer.from(encoded, "base64");
	assert.equal(
		png.toString("base64"),
		encoded,
		"Canonical PNG base64 required",
	);
	assert(png.length >= 33);
	assert(
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
	assert(
		typeof view.zoomLevel === "number" &&
			Number.isFinite(view.zoomLevel) &&
			view.zoomLevel > 0,
	);
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
		changes: differences(seed, opened),
		thumbnail: {
			width: contract.width,
			height: contract.height,
			bytes: png.length,
			sha256: digest(png),
		},
		view: { ...view },
	};
}

/** Byte identity is mandatory after the first-open baseline, including metadata. */
export function assertHighChromaUiExportBytes(baseline, current) {
	const changes = differences(JSON.parse(baseline), JSON.parse(current));
	assert(
		current.equals(baseline),
		`Export changed project bytes: ${JSON.stringify(changes)}`,
	);
	return { sha256: digest(current), byteIdentical: true, changes };
}

export async function prepareHighChromaUiBaseline({
	artifacts,
	request,
	evidence,
}) {
	const initialBytes = await readFile(
		join(artifacts, "project-before-ui.json"),
	);
	const seed = JSON.parse(initialBytes);
	let previous,
		stableSince = Date.now();
	// Require initialization to exist before starting two quiet 800ms save cycles.
	const bytes = await poll(async () => {
		const candidate = await readFile(projectPath(artifacts));
		const opened = JSON.parse(candidate);
		if (
			!opened.record.data.metadata.thumbnail ||
			!opened.record.data.timelineViewState
		) {
			stableSince = Date.now();
			return null;
		}
		validateHighChromaUiFirstOpen(seed, opened);
		const hash = digest(candidate);
		if (hash !== previous) {
			previous = hash;
			stableSince = Date.now();
		}
		if (Date.now() - stableSince < quietMs) return null;
		const retained = await request("record");
		const afterRead = await readFile(projectPath(artifacts));
		if (
			!afterRead.equals(candidate) ||
			!isDeepStrictEqual(retained, {
				record: opened.record,
				summary: opened.summary,
			})
		) {
			stableSince = Date.now();
			return null;
		}
		return candidate;
	}, 30000);
	const firstOpen = validateHighChromaUiFirstOpen(seed, JSON.parse(bytes));
	await writeFile(join(artifacts, "project-after-first-open.json"), bytes, {
		flag: "wx",
	});
	await writeFile(join(artifacts, "project-before-export.json"), bytes, {
		flag: "wx",
	});
	evidence.persistence = {
		initialSha256: digest(initialBytes),
		exportBaselineSha256: digest(bytes),
		firstOpen,
		uiPersistenceQuietMs: quietMs,
		mechanism:
			"Normal first open generates missing timeline PNG and initializes view state; only those exact metadata fields and synchronized updatedAt are allowed before baseline. Export must preserve every byte.",
		exportStages: [],
	};
	return bytes;
}

export async function verifyHighChromaUiExportBaseline({
	artifacts,
	baseline,
	evidence,
	stage,
}) {
	assert(stage === "ui" || stage === "host");
	const start = Date.now();
	const bytes = await poll(async () => {
		const current = await readFile(projectPath(artifacts));
		assertHighChromaUiExportBytes(baseline, current);
		return Date.now() - start >= quietMs ? current : null;
	}, 10000);
	const verified = assertHighChromaUiExportBytes(baseline, bytes);
	await writeFile(
		join(
			artifacts,
			stage === "ui"
				? "project-after-ui-export.json"
				: "project-after-export.json",
		),
		bytes,
		{ flag: "wx" },
	);
	evidence.persistence.exportStages.push({
		stage,
		...verified,
		observationMs: Date.now() - start,
	});
	if (stage === "host")
		evidence.persistence.projectBytesUnchangedByExport = true;
}
