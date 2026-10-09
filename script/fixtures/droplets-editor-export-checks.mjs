import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { capture, poll, seek } from "./stylized-fusion-checks.mjs";
import { normalizeLiquidPreview } from "./liquid-editor-export-decode.mjs";
import { selectIntegerPreview } from "./droplets-editor-lifecycle.mjs";
import {
	prepareLiquidExportBaseline,
	verifyLiquidExportBytes,
} from "./liquid-editor-export-persistence.mjs";
import {
	checkEditorReferences,
	decodeDropletsEditorExport,
} from "./droplets-editor-export-decode.mjs";

export async function runDropletsEditorExport(
	page,
	artifacts,
	evidence,
	request,
	sourceRun,
	ffmpegDirectory,
) {
	assert(ffmpegDirectory && isAbsolute(ffmpegDirectory));
	const before = JSON.parse(
		await readFile(join(artifacts, "reopened-for-export.json"), "utf8"),
	);
	const prepared = JSON.parse(
		await readFile(join(sourceRun, "prepared.json"), "utf8"),
	);
	assert(before.ok && prepared.ok);
	const byId = (items) => [...items].sort((a, b) => a.id.localeCompare(b.id));
	assert.deepEqual(byId(await request("clips")), before.clips);
	const primary = before.clips.find((clip) => clip.id === "droplets-0");
	for (const { key, value } of prepared.changes)
		assert.equal(primary.editing.effects[0].params[key], value);
	assert.equal(primary.editing.effects[0].type, "droplets");
	assert.deepEqual(primary.editing.programmatic, prepared.source);
	const baselineClip = before.clips.find(
		(clip) => clip.id === "droplets-baseline",
	);
	assert.deepEqual(
		baselineClip.editing.programmatic,
		primary.editing.programmatic,
	);
	assert.deepEqual(baselineClip.editing.effects, []);
	assert.deepEqual((await request("record")).record.data.settings.background, {
		type: "color",
		color: "#203040",
	});
	const main = before.tracks.find((track) => track.kind === "video");
	const emptyTrack = await page
		.getByRole("button", { name: `Select ${main.name} track`, exact: true })
		.boundingBox();
	assert(emptyTrack);
	await page.mouse.click(
		emptyTrack.x + emptyTrack.width / 2,
		emptyTrack.y + emptyTrack.height / 2,
	);
	await page.getByText("It's empty here", { exact: true }).waitFor();
	const overlay = page
		.getByRole("application", { name: "Preview canvas", exact: true })
		.locator("..");
	assert.equal(await overlay.locator("button").count(), 0);
	await page.getByLabel("Preview zoom", { exact: true }).click();
	await page.getByRole("option", { name: "100%", exact: true }).click();
	const canvas = page
		.locator('canvas[width="640"][height="360"]')
		.filter({ visible: true });
	assert.equal(
		await canvas.evaluate(
			(element) => getComputedStyle(element.parentElement).backgroundColor,
		),
		"rgb(32, 48, 64)",
	);
	evidence.previewGeometry = await selectIntegerPreview(page, canvas);
	const snapshot = async (ticks, label) => {
		await seek(page, Math.floor(ticks / 120000), (ticks % 120000) / 4000);
		assert.equal(
			await overlay.locator("button").count(),
			0,
			"Preview must have no selection overlay",
		);
		const visible = await capture(page, artifacts, label);
		const { bounds } = visible;
		assert.deepEqual(
			bounds,
			evidence.previewGeometry.bounds,
			"Reference canvas moved or resized",
		);
		assert(Object.values(bounds).every(Number.isInteger));
		const name = `${label}-normalized.png`;
		const { rgba, filter } = await normalizeLiquidPreview(
			join(artifacts, `${label}.png`),
			bounds,
			ffmpegDirectory,
			join(artifacts, name),
		);
		assert.equal(rgba.length, 640 * 360 * 4);
		for (let index = 3; index < rgba.length; index += 4)
			assert.equal(rgba[index], 255);
		const backgroundRgb = [
			...rgba.subarray((3 * 640 + 3) * 4, (3 * 640 + 3) * 4 + 3),
		];
		assert(
			backgroundRgb.every(
				(value, channel) => Math.abs(value - [32, 48, 64][channel]) <= 2,
			),
			`Protected background probe ${backgroundRgb}`,
		);
		return {
			ticks,
			name,
			sha256: createHash("sha256")
				.update(await readFile(join(artifacts, name)))
				.digest("hex"),
			visible,
			normalizationFilter: filter,
			backgroundRgb,
			width: 640,
			height: 360,
			selectionHandles: 0,
		};
	};
	evidence.exportSource = {
		sourceRun,
		projectSha256: before.projectSha256,
		revision: before.revision,
		clip: primary,
	};
	evidence.unfilteredBaseline = await snapshot(
		prepared.baselineTicks,
		"droplets-export-baseline",
	);
	evidence.previewFrames = [];
	for (let frame = 0; frame < 6; frame++)
		evidence.previewFrames.push({
			frame,
			...(await snapshot(
				(frame + 1) * 4000,
				`droplets-export-preview-${frame}`,
			)),
		});
	evidence.counterfactuals = await checkEditorReferences(
		artifacts,
		ffmpegDirectory,
		evidence.previewFrames,
		evidence.unfilteredBaseline.name,
	);
	await page.screenshot({ path: join(artifacts, "export-neutral-editor.png") });
	const exportBaseline = await prepareLiquidExportBaseline(
		artifacts,
		sourceRun,
		request,
		evidence,
	);
	const started = await request("export", {
		format: "webm",
		quality: "very_high",
		includeAudio: false,
		range: { startTime: 4000, endTime: 28000 },
	});
	const finished = await poll(async () => {
		const job = await request(`export/${started.id}`);
		return ["completed", "failed", "cancelled"].includes(job.status)
			? job
			: null;
	}, 90000);
	assert.equal(finished.status, "completed", finished.error);
	await verifyLiquidExportBytes(artifacts, sourceRun, exportBaseline, evidence);
	const contained = relative(
		join(sourceRun, "project/exports"),
		finished.outputPath,
	);
	assert(contained && !contained.startsWith("..") && !isAbsolute(contained));
	evidence.export = finished;
	evidence.decoded = await decodeDropletsEditorExport(
		finished.outputPath,
		artifacts,
		ffmpegDirectory,
		evidence.previewFrames,
		evidence.unfilteredBaseline.name,
	);
	assert.deepEqual(byId(await request("clips")), before.clips);
	assert.deepEqual(byId(await request("tracks")), before.tracks);
	assert.equal((await request("context")).revision, before.revision);
	evidence.checks.push({
		name: "Same UI-edited persisted project, formal six-frame export, independent decode against neutral UI previews and no-effect/repeated-first counterfactuals",
		pass: true,
	});
}
