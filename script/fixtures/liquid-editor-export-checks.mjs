import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { capture, poll, seek } from "./stylized-fusion-checks.mjs";
import {
	decodeLiquidEditorExport,
	normalizeLiquidPreview,
} from "./liquid-editor-export-decode.mjs";
import {
	prepareLiquidExportBaseline,
	verifyLiquidExportBytes,
} from "./liquid-editor-export-persistence.mjs";

export async function runLiquidEditorExport(
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
	assert(before.ok);
	const projectBackground = (await request("record")).record.data.settings
		.background;
	assert.deepEqual(projectBackground, { type: "color", color: "#203040" });
	evidence.background = {
		project: projectBackground,
		preview:
			"actual neutral UI screenshot at 100% zoom; full measured canvas rectangle normalized to 640x360; matching project/CSS background and opaque alpha verified before export",
		probePoint: {
			x: 3,
			y: 3,
			expectedRgb: [32, 48, 64],
			screenshotSamplingTolerance: 2,
		},
	};
	const byId = (items) => [...items].sort((a, b) => a.id.localeCompare(b.id));
	assert.deepEqual(byId(await request("clips")), before.clips);
	const primary = before.clips.find((clip) => clip.id === "liquid-0");
	assert.equal(primary.editing.effects[0].params.viscosity, 0.001);
	assert.equal(primary.editing.effects[0].params.refraction, 0.1);
	assert.equal(primary.editing.effects[0].params.event0Radius, 0.55);
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
	assert.equal(
		await overlay.locator("button").count(),
		0,
		"Actual UI must have no selection handles",
	);
	const canvas = page
		.locator('canvas[width="640"][height="360"]')
		.filter({ visible: true });
	await page.getByLabel("Preview zoom", { exact: true }).click();
	await page.getByRole("option", { name: "100%", exact: true }).click();
	evidence.background.mount = await canvas.evaluate(
		(element) => getComputedStyle(element.parentElement).backgroundColor,
	);
	assert.equal(evidence.background.mount, "rgb(32, 48, 64)");
	evidence.exportSource = {
		sourceRun,
		projectSha256: before.projectSha256,
		revision: before.revision,
		clip: primary,
	};
	evidence.previewFrames = [];
	for (let frame = 0; frame < 6; frame++) {
		const ticks = (frame + 1) * 4000;
		await seek(page, 0, frame + 1);
		assert.equal(await overlay.locator("button").count(), 0);
		const visible = await capture(
			page,
			artifacts,
			`liquid-export-preview-${frame}`,
		);
		const name = `liquid-export-normalized-${frame}.png`;
		const bounds = visible.bounds;
		assert(
			bounds.width >= 630 &&
				bounds.width <= 640 &&
				bounds.height >= 350 &&
				bounds.height <= 360,
		);
		const viewport = page.viewportSize();
		assert(
			bounds.x >= 0 &&
				bounds.y >= 0 &&
				bounds.x + bounds.width <= viewport.width &&
				bounds.y + bounds.height <= viewport.height,
		);
		const { rgba, filter } = await normalizeLiquidPreview(
			join(artifacts, `${visible.name}.png`),
			bounds,
			ffmpegDirectory,
			join(artifacts, name),
		);
		assert.equal(rgba.length, 640 * 360 * 4);
		let activePixels = 0;
		for (let index = 0; index < rgba.length; index += 4) {
			assert.equal(
				rgba[index + 3],
				255,
				"Visible preview must already composite the matching project background",
			);
			if (
				[32, 48, 64].some(
					(background, channel) =>
						Math.abs(rgba[index + channel] - background) > 15,
				)
			)
				activePixels++;
		}
		assert(
			activePixels > 2000,
			"Preview reference must have non-background active detail before export",
		);
		const backgroundRgb = [
			...rgba.subarray((3 * 640 + 3) * 4, (3 * 640 + 3) * 4 + 3),
		];
		assert(
			backgroundRgb.every(
				(value, channel) => Math.abs(value - [32, 48, 64][channel]) <= 2,
			),
			`Predeclared transparent-corner background probe: ${backgroundRgb}`,
		);
		evidence.previewFrames.push({
			frame,
			ticks,
			name,
			sha256: createHash("sha256")
				.update(await readFile(join(artifacts, name)))
				.digest("hex"),
			visible,
			normalizationFilter: filter,
			activePixels,
			backgroundRgb,
			width: 640,
			height: 360,
			selectionHandles: 0,
		});
	}
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
	const inside = relative(
		join(sourceRun, "project/exports"),
		finished.outputPath,
	);
	assert(inside && !inside.startsWith("..") && !isAbsolute(inside));
	evidence.export = finished;
	evidence.decoded = await decodeLiquidEditorExport(
		finished.outputPath,
		artifacts,
		ffmpegDirectory,
		evidence.previewFrames,
	);
	assert.deepEqual(byId(await request("clips")), before.clips);
	assert.deepEqual(byId(await request("tracks")), before.tracks);
	assert.equal((await request("context")).revision, before.revision);
	evidence.checks.push({
		name: "same real UI-edited persisted project, formal six-frame export, independent FFmpeg decode against complete UI preview screenshots without selection overlays",
		pass: true,
	});
}
