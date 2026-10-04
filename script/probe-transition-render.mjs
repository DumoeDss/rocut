import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { isAbsolute, join, relative } from "node:path";
import { expect } from "@playwright/test";
import { probeTransitionAuthoring } from "./probe-transition-authoring.mjs";
const run = (args) => execFileSync("ffmpeg", args, { windowsHide: true });
function verifyColor(pixel, progress) {
	assert(pixel[1] < 70, "Dissolve must not add green: " + pixel);
	assert(
		Math.abs(pixel[0] - 255 * (1 - progress)) < 55 &&
			Math.abs(pixel[2] - 255 * progress) < 55,
		"Expected red/blue dissolve at " + progress + ": " + pixel,
	);
}
async function preview(page, progress) {
	let colors;
	await expect
		.poll(
			async () => {
				const bytes = await page.locator("canvas").first().screenshot();
				colors = await page.evaluate(async (bytes) => {
					const bitmap = await createImageBitmap(
						new Blob([new Uint8Array(bytes)], { type: "image/png" }),
					);
					try {
						const canvas = new OffscreenCanvas(bitmap.width, bitmap.height),
							ctx = canvas.getContext("2d");
						ctx.drawImage(bitmap, 0, 0);
						return [
							[0.5, 0.5],
							[0.1, 0.1],
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
				}, Array.from(bytes));
				try {
					for (const pixel of colors) verifyColor(pixel, progress);
					return true;
				} catch {
					return false;
				}
			},
			{
				timeout: 20000,
				message: "Real preview must show the sampled dissolve",
			},
		)
		.toBe(true);
	return colors;
}
async function seek(page, timecode) {
	await page.getByLabel("Edit playhead time", { exact: true }).click();
	await page.getByLabel("Playhead time", { exact: true }).fill(timecode);
	await page.getByLabel("Playhead time", { exact: true }).press("Enter");
}
async function exportDissolve({ page, project }) {
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
				range: { startTime: 240000, endTime: 480000 },
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
	for (const [seconds, progress] of [
		[0.4, 0],
		[0.75, 0.25],
		[1, 0.5],
		[1.25, 0.75],
		[1.6, 1],
	]) {
		const bytes = run([
			"-v",
			"error",
			"-ss",
			String(seconds),
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
		assert.equal(bytes.length, 160 * 90 * 3);
		const pixels = [
			[80, 45],
			[16, 9],
		].map(([x, y]) =>
			Array.from(bytes.subarray((y * 160 + x) * 3, (y * 160 + x) * 3 + 3)),
		);
		for (const pixel of pixels) verifyColor(pixel, progress);
		decoded.push({ seconds, progress, pixels });
	}
	return decoded;
}

// Geometry is seeded only in the owned test project. With authorUi, the relation
// is created through real controls; otherwise this is rendering-only acceptance.
export async function probeTransitionRender({
	page,
	project,
	work,
	evidence,
	onPhase,
	authorUi = false,
	mediaKind = "video",
}) {
	onPhase("transition render media import");
	const filenames = mediaKind === "image" ? ["dissolve-red.png", "dissolve-blue.png"] : ["dissolve-source.mp4"];
	for (const [index, name] of filenames.entries()) {
		const source = join(work, name);
		if (mediaKind === "image") run(["-v", "error", "-n", "-f", "lavfi", "-i", "color=c=" + (index ? "blue" : "red") + ":s=640x360", "-frames:v", "1", source]);
		else run(["-v", "error", "-n", "-f", "lavfi", "-i", "color=c=red:s=640x360:r=30:d=8", "-vf", "drawbox=c=blue:t=fill:enable='gte(t,4)'", "-c:v", "libx264", "-pix_fmt", "yuv420p", source]);
		await page.getByLabel("Media", { exact: true }).click();
		await page.locator('input[type="file"]').setInputFiles(source);
		const list = page.getByLabel("Switch to list view", { exact: true });
		if (await list.count()) await list.click();
		await page.getByLabel("Add " + name + " to timeline", { exact: true }).click();
		await expect.poll(async () => { const tracks = await page.evaluate(async () =>
			(await (await fetch(new URL("api/record", location.href))).json()).record.data.scenes[0].tracks,
		); return [tracks.main, ...tracks.overlay].reduce((sum, track) => sum + track.elements.length, 0); }).toBe(index + 1);
	}
	await page.reload();
	await page.evaluate(async ({ authorUi, mediaKind }) => {
		const url = new URL("api/record", location.href),
			envelope = await (await fetch(url)).json();
		const data = envelope.record.data,
			tracks = data.scenes[0].tracks,
			track = tracks.main,
			allClips = [track, ...tracks.overlay].flatMap((entry) => entry.elements),
			original = mediaKind === "image" ? allClips.find((clip) => clip.name === "dissolve-red.png") : allClips[0],
			second = allClips.find((clip) => clip.name === "dissolve-blue.png");
		if (!original || (mediaKind === "image" && !second)) throw Error("Imported transition sources unavailable");
		data.settings.fps = { numerator: 30, denominator: 1 };
		const outgoing = {
			...original,
			startTime: 0,
			duration: 360000,
			trimStart: 0,
			trimEnd: mediaKind === "video" ? 600000 : 0,
		};
		const incoming = {
			...(mediaKind === "image" ? second : original),
			id: crypto.randomUUID(),
			startTime: 360000,
			duration: 240000,
			trimStart: mediaKind === "video" ? 600000 : 0,
			trimEnd: mediaKind === "video" ? 120000 : 0,
			transitionIn: {
				kind: "cross-dissolve",
				outgoingClipId: outgoing.id,
				durationFrames: 30,
			},
		};
		if (authorUi) delete incoming.transitionIn;
		track.elements = [outgoing, incoming];
		tracks.overlay = [];
		const response = await fetch(url, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(envelope),
		});
		if (!response.ok)
			throw Error("Failed to seed owned dissolve: " + response.status);
	}, { authorUi, mediaKind });
	await page.reload();
	if (authorUi) {
		evidence.transitionAuthoringScreenshot = join(work, "transition-authoring.png");
		await probeTransitionAuthoring({ page, evidence, onPhase, preview, seek });
	}
	onPhase("transition preview source handles");
	const samples = [];
	for (const [timecode, progress] of [
		["00:00:02:15", 0],
		["00:00:02:23", 8 / 30],
		["00:00:03:00", 0.5],
		["00:00:03:07", 22 / 30],
		["00:00:03:15", 1],
		["00:00:03:00", 0.5],
	]) {
		await seek(page, timecode);
		samples.push({ timecode, progress, pixels: await preview(page, progress) });
	}
	evidence.checks.push({
		name: "installed scene renders " + mediaKind + " dissolve across the cut and half-open end",
		pass: true,
		samples,
	});
	onPhase("transition decoded range export");
	evidence.checks.push({
		name: "decoded MP4 nonzero range contains red, intermediate blends and blue",
		pass: true,
		decoded: await exportDissolve({ page, project }),
	});
	onPhase("transition grouped blur fixture");
	await page.reload();
	await page.evaluate(async () => {
		const url = new URL("api/record", location.href),
			envelope = await (await fetch(url)).json();
		const data = envelope.record.data;
		data.settings.background = { type: "blur", blurIntensity: 12 };
		data.scenes[0].tracks.main.elements.forEach((clip, i) => {
			clip.params = {
				...clip.params,
				"transform.scaleX": 0.5,
				"transform.scaleY": 0.5,
				opacity: i ? 0.75 : 0.25,
			};
		});
		const response = await fetch(url, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(envelope),
		});
		if (!response.ok)
			throw Error("Failed to seed owned blur fixture: " + response.status);
	});
	await page.reload();
	const blurred = [];
	for (const [timecode, progress] of [
		["00:00:02:23", 8 / 30],
		["00:00:03:00", 0.5],
		["00:00:03:07", 22 / 30],
	]) {
		await seek(page, timecode);
		const pixels = await preview(page, progress);
		for (let channel = 0; channel < 3; channel++)
			assert(
				Math.abs(pixels[0][channel] - pixels[1][channel]) < 15,
				"Picture and own backdrop must be grouped before blending",
			);
		blurred.push({ timecode, progress, pixels });
	}
	evidence.checks.push({
		name: "different picture opacities preserve matching own-backdrop blend after reload",
		pass: true,
		samples: blurred,
	});
	onPhase("transition grouped blur decoded export");
	evidence.checks.push({
		name: "decoded grouped-blur dissolve preserves center and backdrop",
		pass: true,
		decoded: await exportDissolve({ page, project }),
	});
	evidence.notTransitionAuthoringUiAcceptance = !authorUi;
}
