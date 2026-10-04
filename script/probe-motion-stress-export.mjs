import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { expect } from "@playwright/test";

// Real host API + installed renderer, not export-button UI acceptance.
export async function probeMotionStressExport({
	page,
	project,
	evidence,
	onPhase,
}) {
	const request = (path, body) =>
		page.evaluate(
			async ({ path, body }) => {
				const response = await fetch(new URL(path, location.href), {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					...(body === undefined ? {} : { body: JSON.stringify(body) }),
				});
				return { status: response.status, body: await response.json() };
			},
			{ path, body },
		);
	const get = (id) =>
		page.evaluate(
			async (id) =>
				(await fetch(new URL("api/export/" + id, location.href))).json(),
			id,
		);
	const snapshot = () =>
		page.evaluate(async () => {
			const data = (
				await (await fetch(new URL("api/record", location.href))).json()
			).record.data;
			return {
				scenes: data.scenes,
				sequences: data.motionTextSequences,
				settings: data.settings,
			};
		});
	const before = await snapshot();
	assert.equal(before.sequences[0].cues.length, 600);
	assert.equal(before.sequences[0].duration, 480 * 120000);
	onPhase("F05 cancel an actively encoding full eight-minute export");
	const started = await request("api/export", {
		format: "mp4",
		quality: "high",
		includeAudio: false,
	});
	assert.equal(started.status, 202);
	const id = started.body.id;
	let terminal = false;
	try {
		let running;
		await expect
			.poll(
				async () => {
					running = await get(id);
					assert(
						!["completed", "failed", "cancelled"].includes(running.status),
						"Expected active encoder: " + JSON.stringify(running),
					);
					return running.status === "running" && running.progress > 0;
				},
				{ timeout: 30000, intervals: [25, 50, 100] },
			)
			.toBe(true);
		const result = await page.evaluate(async (id) => {
			const started = performance.now();
			const cancel = await fetch(
				new URL("api/export/" + id + "/cancel", location.href),
				{ method: "POST" },
			);
			const acknowledgement = await cancel.json();
			for (let attempt = 0; attempt < 400; attempt++) {
				const job = await (
					await fetch(new URL("api/export/" + id, location.href))
				).json();
				if (["completed", "failed", "cancelled"].includes(job.status))
					return {
						job,
						milliseconds: performance.now() - started,
						acknowledgement,
						httpStatus: cancel.status,
					};
				await new Promise((resolve) => setTimeout(resolve, 25));
			}
			throw new Error("F05 cancellation did not settle");
		}, id);
		terminal = ["completed", "failed", "cancelled"].includes(result.job.status);
		evidence.checks.push({
			name: "F05 active export cancellation within one second",
			progressBeforeCancel: running.progress,
			...result,
			pass: result.job.status === "cancelled" && result.milliseconds <= 1000,
		});
		assert.equal(result.httpStatus, 200);
		assert.equal(result.acknowledgement.cancelRequested, true);
		assert.equal(result.job.status, "cancelled");
		assert.equal(result.job.outputPath, undefined);
		assert(
			result.milliseconds <= 1000,
			"F05 cooperative cancellation exceeded 1000 ms: " + result.milliseconds,
		);
		const files = await readdir(join(project, "exports")).catch((error) => {
			if (error.code === "ENOENT") return [];
			throw error;
		});
		assert(
			!files.some((name) => name.includes(id)),
			"Cancelled export left a partial output",
		);
		assert.deepEqual(await snapshot(), before);
	} finally {
		if (!terminal) await request("api/export/" + id + "/cancel");
	}

	onPhase("F05 1080p tail range export after cancellation");
	const retry = await request("api/export", {
		format: "mp4",
		quality: "high",
		includeAudio: false,
		range: { startTime: 478 * 120000, endTime: 480 * 120000 },
	});
	assert.equal(retry.status, 202);
	let job;
	try {
		await expect
			.poll(
				async () => {
					job = await get(retry.body.id);
					return ["completed", "failed", "cancelled"].includes(job.status);
				},
				{ timeout: 120000, intervals: [100, 250, 500] },
			)
			.toBe(true);
		assert.equal(job.status, "completed", job.error);
	} finally {
		if (!job || !["completed", "failed", "cancelled"].includes(job.status))
			await request("api/export/" + retry.body.id + "/cancel");
	}
	const outputRelative = relative(join(project, "exports"), job.outputPath);
	assert(
		outputRelative &&
			!outputRelative.startsWith("..") &&
			!isAbsolute(outputRelative),
	);
	const metadata = JSON.parse(
		execFileSync(
			"ffprobe",
			[
				"-v",
				"error",
				"-count_frames",
				"-show_streams",
				"-show_format",
				"-of",
				"json",
				job.outputPath,
			],
			{ encoding: "utf8", windowsHide: true, timeout: 30000 },
		),
	);
	const videos = metadata.streams.filter(
		(stream) => stream.codec_type === "video",
	);
	assert.equal(videos.length, 1);
	assert.equal(videos[0].width, 1920);
	assert.equal(videos[0].height, 1080);
	assert.equal(videos[0].nb_read_frames, "60");
	assert.equal(videos[0].avg_frame_rate, "30/1");
	assert.equal(
		metadata.streams.filter((stream) => stream.codec_type === "audio").length,
		0,
	);
	const samples = [];
	// Use persisted Rust-plan cut centers, not arbitrary timestamps that can
	// land on a legitimate fade boundary. Keep the glyph threshold unchanged.
	const rangeStart = 478 * 120000;
	const candidates = before.sequences[0].resolvedPlan.cuts.filter((cut) => {
		const center = cut.startTime + cut.duration / 2;
		return cut.text && center >= rangeStart && center < 480 * 120000;
	});
	assert(candidates.length >= 3);
	for (const index of [
		0,
		Math.floor(candidates.length / 2),
		candidates.length - 1,
	]) {
		const cut = candidates[index];
		const frame = Math.round(
			(cut.startTime + cut.duration / 2 - rangeStart) / 4000,
		);
		const seconds = frame / 30;
		assert(
			rangeStart + frame * 4000 >= cut.startTime &&
				rangeStart + frame * 4000 < cut.startTime + cut.duration,
		);
		const pixels = execFileSync(
			"ffmpeg",
			[
				"-v",
				"error",
				"-ss",
				String(seconds),
				"-i",
				job.outputPath,
				"-frames:v",
				"1",
				"-vf",
				"scale=320:180",
				"-f",
				"rawvideo",
				"-pix_fmt",
				"rgb24",
				"pipe:1",
			],
			{ windowsHide: true, timeout: 30000 },
		);
		let light = 0;
		for (let i = 0; i < pixels.length; i += 3)
			if (pixels[i] > 160 && pixels[i + 1] > 160 && pixels[i + 2] > 160)
				light++;
		assert(
			light > 20,
			"F05 decoded tail frame is missing glyphs at " + seconds,
		);
		samples.push({ seconds, frame, cutId: cut.id, text: cut.text, light });
	}
	assert.deepEqual(await snapshot(), before);
	evidence.checks.push({
		name: "F05 1080p final two seconds export contains 60 decoded frames and visible glyphs after cancel/retry",
		samples,
		pass: true,
	});
}
