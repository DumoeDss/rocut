import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { isAbsolute, join, relative } from "node:path";
import { expect } from "@playwright/test";

const run = (command, args) =>
	execFileSync(command, args, { windowsHide: true });
const expected = [
	[255, 0, 0],
	[0, 255, 0],
	[0, 0, 255],
	[255, 255, 0],
];
function checkColors(colors) {
	for (let i = 0; i < expected.length; i++)
		for (let channel = 0; channel < 3; channel++)
			assert(
				Math.abs(colors[i][channel] - expected[i][channel]) < 45,
				"Four quadrants must retain distinct source frames: " +
					JSON.stringify(colors),
			);
}
async function previewColors(page) {
	const png = await page.locator("canvas").first().screenshot();
	return page.evaluate(async (bytes) => {
		const bitmap = await createImageBitmap(
			new Blob([new Uint8Array(bytes)], { type: "image/png" }),
		);
		try {
			const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
			const ctx = canvas.getContext("2d");
			ctx.drawImage(bitmap, 0, 0);
			return [
				[0.25, 0.25],
				[0.75, 0.25],
				[0.25, 0.75],
				[0.75, 0.75],
			].map(([x, y]) =>
				Array.from(
					ctx.getImageData(
						Math.floor(x * bitmap.width),
						Math.floor(y * bitmap.height),
						1,
						1,
					).data,
				).slice(0, 3),
			);
		} finally {
			bitmap.close();
		}
	}, Array.from(png));
}
async function verifyPreview(page) {
	let colors;
	await expect
		.poll(
			async () => {
				colors = await previewColors(page);
				try {
					checkColors(colors);
					return true;
				} catch {
					return false;
				}
			},
			{ timeout: 20000, message: "Preview preserves four same-source samples" },
		)
		.toBe(true);
	return colors;
}
async function seek(page, frames) {
	await page.getByLabel("Edit playhead time", { exact: true }).click();
	await page
		.getByLabel("Playhead time", { exact: true })
		.fill("00:00:00:" + String(frames).padStart(2, "0"));
	await page.getByLabel("Playhead time", { exact: true }).press("Enter");
}

// Import uses real UI; only the four-track layout is seeded into an owned record.
// This proves render/export frame lifetime, not transition authoring or dissolve UI.
export async function probeVideoSourceLifetime({
	page,
	project,
	work,
	evidence,
	onPhase,
}) {
	onPhase("same-source video import");
	const source = join(work, "source-lifetime.mp4");
	run("ffmpeg", [
		"-v",
		"error",
		"-n",
		"-f",
		"lavfi",
		"-i",
		"color=c=red:s=640x360:r=30:d=8",
		"-vf",
		"drawbox=c=lime:t=fill:enable='gte(t,2)',drawbox=c=blue:t=fill:enable='gte(t,4)',drawbox=c=yellow:t=fill:enable='gte(t,6)'",
		"-c:v",
		"libx264",
		"-pix_fmt",
		"yuv420p",
		source,
	]);
	await page.getByLabel("Media", { exact: true }).click();
	await page.locator('input[type="file"]').setInputFiles(source);
	const list = page.getByLabel("Switch to list view", { exact: true });
	if (await list.count()) await list.click();
	await page
		.getByLabel("Add source-lifetime.mp4 to timeline", { exact: true })
		.click();
	await expect
		.poll(() =>
			page.evaluate(
				async () =>
					(await (await fetch(new URL("api/record", location.href))).json())
						.record.data.scenes[0].tracks.main.elements.length,
			),
		)
		.toBe(1);
	await page.reload();
	onPhase("owned four-track source-time fixture");
	evidence.sourceLifetimeFixture = await page.evaluate(async () => {
		const url = new URL("api/record", location.href);
		const envelope = await (await fetch(url)).json();
		const data = envelope.record.data;
		const tracks = data.scenes[0].tracks;
		const original = tracks.main.elements[0];
		const width = data.settings.canvasSize.width,
			height = data.settings.canvasSize.height;
		const clips = [
			[-1, -1],
			[1, -1],
			[-1, 1],
			[1, 1],
		].map(([x, y], i) => ({
			...original,
			id: crypto.randomUUID(),
			name: "Source quadrant " + i,
			startTime: 0,
			duration: 120000,
			trimStart: i * 240000,
			trimEnd: (7 - i * 2) * 120000,
			params: {
				...original.params,
				"transform.scaleX": 0.5,
				"transform.scaleY": 0.5,
				"transform.positionX": (x * width) / 4,
				"transform.positionY": (y * height) / 4,
				"transform.rotate": 0,
			},
		}));
		tracks.main.elements = [clips[0]];
		tracks.overlay = clips.slice(1).map((clip, i) => ({
			id: crypto.randomUUID(),
			name: "Source layer " + i,
			type: "video",
			isMain: false,
			muted: false,
			hidden: false,
			elements: [clip],
		}));
		const response = await fetch(url, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(envelope),
		});
		if (!response.ok)
			throw Error("Failed to seed owned source fixture: " + response.status);
		return {
			width,
			height,
			mediaId: original.mediaId,
			fixtureSetup: "owned storage seed, not four-track authoring UI",
		};
	});
	await page.reload();
	onPhase("same-source preview seeks");
	const samples = [];
	for (const frame of [15, 5, 25, 15]) {
		await seek(page, frame);
		samples.push({ frame, colors: await verifyPreview(page) });
	}
	evidence.checks.push({
		name: "four layers of one video retain red/green/blue/yellow after forward/backward preview seeks",
		pass: true,
		samples,
	});
	await page.reload();
	await seek(page, 15);
	evidence.checks.push({
		name: "same-source preview survives iframe reload",
		pass: true,
		colors: await verifyPreview(page),
	});
	onPhase("same-source decoded MP4 export");
	await expect
		.poll(() =>
			page.evaluate(
				async () =>
					(await (await fetch(new URL("api/export", location.href))).json())
						.surfaces,
			),
		)
		.toBe(1);
	const started = await page.evaluate(async () => {
		const response = await fetch(new URL("api/export", location.href), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				format: "mp4",
				quality: "low",
				includeAudio: false,
				range: { startTime: 0, endTime: 120000 },
			}),
		});
		return { status: response.status, job: await response.json() };
	});
	assert.equal(started.status, 202);
	let job;
	await expect
		.poll(
			async () => {
				job = await page.evaluate(
					async (id) =>
						(await fetch(new URL("api/export/" + id, location.href))).json(),
					started.job.id,
				);
				return ["completed", "failed", "cancelled"].includes(job.status);
			},
			{ timeout: 120000, intervals: [250, 500, 1000] },
		)
		.toBe(true);
	assert.equal(job.status, "completed", job.error);
	const output = relative(join(project, "exports"), job.outputPath);
	assert(output && !output.startsWith("..") && !isAbsolute(output));
	const decoded = [];
	for (const time of [0.1, 0.5, 0.8]) {
		const pixels = run("ffmpeg", [
			"-v",
			"error",
			"-ss",
			String(time),
			"-i",
			job.outputPath,
			"-frames:v",
			"1",
			"-vf",
			"scale=160:90",
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgb24",
			"pipe:1",
		]);
		assert.equal(pixels.length, 160 * 90 * 3);
		const colors = [
			[40, 22],
			[120, 22],
			[40, 67],
			[120, 67],
		].map(([x, y]) =>
			Array.from(pixels.subarray((y * 160 + x) * 3, (y * 160 + x) * 3 + 3)),
		);
		checkColors(colors);
		decoded.push({ time, colors });
	}
	evidence.checks.push({
		name: "decoded MP4 preserves distinct same-media source times at three frames",
		pass: true,
		decoded,
	});
	await seek(page, 15);
	evidence.checks.push({
		name: "preview remains correct after export decoder activity",
		pass: true,
		colors: await verifyPreview(page),
	});
	evidence.notTransitionUiOrRenderAcceptance = true;
}
