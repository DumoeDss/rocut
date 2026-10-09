import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { poll } from "./stylized-fusion-checks.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const projectPath = (sourceRun) => join(sourceRun, "project/project.json");

export async function waitForCloudsPersistence(sourceRun, request) {
	let previous,
		stableSince = Date.now();
	return poll(async () => {
		const bytes = await readFile(projectPath(sourceRun));
		const current = digest(bytes);
		if (current !== previous) {
			previous = current;
			stableSince = Date.now();
		}
		const disk = JSON.parse(bytes);
		const retained = await request("record");
		return Date.now() - stableSince >= 1600 &&
			isDeepStrictEqual(retained, {
				record: disk.record,
				summary: disk.summary,
			})
			? bytes
			: null;
	});
}

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
	const bounded = (value) =>
		typeof value === "string" && value.length > 200
			? { length: value.length, sha256: digest(value) }
			: value;
	return [{ pointer, before: bounded(before), after: bounded(after) }];
}

export async function prepareCloudsExportBaseline(
	artifacts,
	sourceRun,
	request,
	evidence,
) {
	// SaveManager's production debounce is 800 ms. Observe two quiet cycles after
	// all UI actions, without calling internal stores or forcing a synthetic save.
	const bytes = await waitForCloudsPersistence(sourceRun, request);
	await writeFile(join(artifacts, "project-before-export.json"), bytes, {
		flag: "wx",
	});
	const initialBytes = await readFile(
		join(artifacts, "project-before-ui.json"),
	);
	const initial = JSON.parse(initialBytes),
		baseline = JSON.parse(bytes);
	const retained = await request("record");
	assert.deepEqual(retained, {
		record: baseline.record,
		summary: baseline.summary,
	});
	const changes = differences(initial, baseline);
	evidence.persistence = {
		initialSha256: digest(initialBytes),
		exportBaselineSha256: digest(bytes),
		uiStageChanges: changes,
		uiPersistenceQuietMs: 1600,
		mechanism:
			"timeline view changes mark SaveManager dirty; its 800ms debounce calls saveCurrentProject, updating metadata and summary timestamps without a transaction revision",
	};
	const allowed = new Set([
		"/record/data/metadata/updatedAt",
		"/summary/updatedAt",
		"/record/data/timelineViewState/zoomLevel",
		"/record/data/timelineViewState/scrollLeft",
		"/record/data/timelineViewState/playheadTime",
	]);
	assert(
		changes.every((change) => allowed.has(change.pointer)),
		JSON.stringify(changes),
	);
	assert.equal(
		baseline.record.data.metadata.updatedAt,
		baseline.summary.updatedAt,
	);
	return bytes;
}

export async function verifyCloudsExportBytes(
	artifacts,
	sourceRun,
	baseline,
	evidence,
) {
	const bytes = await readFile(projectPath(sourceRun));
	await writeFile(join(artifacts, "project-after-export.json"), bytes, {
		flag: "wx",
	});
	evidence.persistence.afterExportSha256 = digest(bytes);
	evidence.persistence.exportStageChanges = differences(
		JSON.parse(baseline),
		JSON.parse(bytes),
	);
	assert(
		bytes.equals(baseline),
		JSON.stringify(evidence.persistence.exportStageChanges),
	);
	evidence.persistence.projectBytesUnchangedByExport = true;
}
