import assert from "node:assert/strict";
import { copyFile, readFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { poll } from "./stylized-fusion-checks.mjs";
import {
	prepareHighChromaUiBaseline,
	verifyHighChromaUiExportBaseline,
} from "./high-chroma-ui-persistence.mjs";
import { highChromaUiContract as contract } from "./high-chroma-ui-contract.mjs";
import { inspectHighChromaUiMedia } from "./high-chroma-ui-decode.mjs";

export async function runHighChromaUiChecks({
	page,
	artifacts,
	evidence,
	request,
	ffmpegDirectory,
}) {
	const prepared = JSON.parse(
		await readFile(join(artifacts, "prepared.json"), "utf8"),
	);
	assert(prepared.ok && prepared.hostReopened && prepared.authorUnavailable);
	assert.equal(prepared.clips.length, 1);
	assert.equal(prepared.clips[0].duration, contract.durationTicks);
	const status = await request("export");
	assert.deepEqual(status.protocol, {
		version: 2,
		videoChroma: ["420", "444"],
	});
	assert.equal(status.surfaces, 1);
	assert.equal(status.jobs.length, 0);
	assert(evidence.paneRegistrations.length > 0);
	assert(
		evidence.paneRegistrations.every(
			(item) => item.exportProtocol === "2" && item.exportVideoChroma === "444",
		),
	);
	evidence.hostProtocol = status.protocol;
	await page.screenshot({ path: join(artifacts, "editor-before-export.png") });
	await page.getByRole("button", { name: "Editor menu", exact: true }).click();
	await page
		.getByRole("menuitem", { name: "Export project", exact: true })
		.click();
	const dialog = page.getByRole("dialog", {
		name: "Export project",
		exact: true,
	});
	await dialog.waitFor();
	await dialog.getByRole("button", { name: "Format", exact: true }).click();
	await dialog.getByRole("button", { name: "Quality", exact: true }).click();
	const mp4 = dialog.getByRole("radio", {
		name: "MP4 (H.264) - Better compatibility",
		exact: true,
	});
	const webm = dialog.getByRole("radio", {
		name: "WebM (VP9) - Smaller file size",
		exact: true,
	});
	const medium = dialog.getByRole("radio", {
		name: "Medium - Balanced",
		exact: true,
	});
	const high = dialog.getByRole("radio", {
		name: "High - Recommended",
		exact: true,
	});
	const chroma = dialog.getByRole("combobox", {
		name: "Color sampling",
		exact: true,
	});
	const checked = async (locator) =>
		assert.equal(await locator.getAttribute("aria-checked"), "true");
	evidence.uiTransitions = [];
	const observe = async (name) => {
		evidence.uiTransitions.push({
			name,
			checkedRadioIds: await dialog
				.locator('[role="radio"][aria-checked="true"]')
				.evaluateAll((elements) => elements.map((element) => element.id)),
			videoChroma: (await chroma.count()) ? await chroma.inputValue() : null,
		});
	};
	await checked(mp4);
	await checked(high);
	assert.equal(await chroma.count(), 0);
	await observe("initial MP4/high; color sampling hidden");
	await webm.click();
	assert.equal(await chroma.inputValue(), "420");
	await checked(high);
	await observe("WebM defaults to 420 without changing quality");
	await medium.click();
	await chroma.selectOption("444");
	await checked(medium);
	assert.equal(await chroma.inputValue(), "444");
	await observe("explicit 444 preserves medium quality");
	await mp4.click();
	assert.equal(await chroma.count(), 0);
	await checked(medium);
	await observe("switch to MP4 hides and clears 444");
	await webm.click();
	assert.equal(await chroma.inputValue(), "420");
	await checked(medium);
	await observe("return to WebM is 420, still medium");
	await chroma.selectOption("444");
	await dialog.getByRole("button", { name: "Audio", exact: true }).click();
	const audio = dialog.getByRole("checkbox", {
		name: "Include audio in export",
		exact: true,
	});
	assert.equal(await audio.getAttribute("aria-checked"), "true");
	await audio.click();
	assert.equal(await audio.getAttribute("aria-checked"), "false");
	await checked(webm);
	await checked(medium);
	assert.equal(await chroma.inputValue(), "444");
	await observe("final real UI selection before Export");
	evidence.uiSelection = {
		...contract.request,
		capture:
			"Actual visible dialog controls; no interception of internal renderer methods",
	};
	await page.screenshot({ path: join(artifacts, "ui-export-options.png") });
	const baseline = await prepareHighChromaUiBaseline({
		artifacts,
		request,
		evidence,
	});
	const downloadPending = page.waitForEvent("download", { timeout: 120000 });
	await dialog.getByRole("button", { name: "Export", exact: true }).click();
	const download = await downloadPending;
	assert.equal(await download.failure(), null);
	assert(download.suggestedFilename().endsWith(".webm"));
	const uiPath = join(artifacts, "ui.webm");
	await download.saveAs(uiPath);
	evidence.uiDownload = {
		path: uiPath,
		filename: download.suggestedFilename(),
	};
	await dialog.waitFor({ state: "hidden", timeout: 15000 });
	assert.equal(
		(await request("export")).jobs.length,
		0,
		"UI export uses the actual local renderer, not a synthetic Host job",
	);
	evidence.uiExport = await inspectHighChromaUiMedia({
		mediaPath: uiPath,
		artifacts,
		label: "ui",
		ffmpegDirectory,
	});
	await verifyHighChromaUiExportBaseline({
		artifacts,
		baseline,
		evidence,
		stage: "ui",
	});
	const hostOptions = {
		...contract.request,
		range: { startTime: 0, endTime: contract.durationTicks },
	};
	evidence.hostRequest = hostOptions;
	const started = await request("export", hostOptions);
	assert.deepEqual(started.options, hostOptions);
	const finished = await poll(async () => {
		const job = await request(`export/${started.id}`);
		return ["completed", "failed", "cancelled"].includes(job.status)
			? job
			: null;
	}, 120000);
	evidence.hostJob = finished;
	assert.equal(finished.status, "completed", finished.error);
	assert.deepEqual(finished.options, hostOptions);
	const contained = relative(
		join(artifacts, "project/exports"),
		finished.outputPath,
	);
	assert(contained && !contained.startsWith("..") && !isAbsolute(contained));
	const hostPath = join(artifacts, "host.webm");
	await copyFile(finished.outputPath, hostPath);
	evidence.hostExport = await inspectHighChromaUiMedia({
		mediaPath: hostPath,
		artifacts,
		label: "host",
		ffmpegDirectory,
	});
	await page.screenshot({ path: join(artifacts, "editor-after-exports.png") });
	await verifyHighChromaUiExportBaseline({
		artifacts,
		baseline,
		evidence,
		stage: "host",
	});
	const byId = (items) => [...items].sort((a, b) => a.id.localeCompare(b.id));
	assert.deepEqual(byId(await request("clips")), prepared.clips);
	assert.deepEqual(byId(await request("tracks")), prepared.tracks);
	assert.equal((await request("context")).revision, prepared.revision);
	evidence.checks.push({
		name: "Real UI option/reset/quality interaction and download; actual protocol-2 pane plus HTTP444 export; both independent six-frame Profile1/yuv444p inspections",
		pass: true,
	});
}
