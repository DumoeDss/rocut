import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { expect } from "@playwright/test";

// Fault injection verifies the installed cancellation path, not healthy export throughput.
export async function probeExportBackpressure({ page, evidence, onPhase }) {
	evidence.acceptanceEligible = false;
	evidence.diagnosticFaultInjected =
		"VideoEncoder dequeue backpressure in owned E2E iframe";
	const request = (path, body) =>
		page.evaluate(
			async ({ path, body }) => {
				const response = await fetch(new URL(path, location.href), {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					...(body ? { body: JSON.stringify(body) } : {}),
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
	onPhase("inject a stuck VideoEncoder dequeue wait into the owned editor");
	await page.evaluate(() => {
		const prototype = VideoEncoder.prototype;
		const queue = Object.getOwnPropertyDescriptor(prototype, "encodeQueueSize");
		const listener = Object.getOwnPropertyDescriptor(
			prototype,
			"addEventListener",
		);
		if (!queue?.configurable)
			throw Error("Encoder queue cannot be instrumented");
		const add = prototype.addEventListener;
		const state = {
			blocked: 0,
			restore() {
				Object.defineProperty(prototype, "encodeQueueSize", queue);
				if (listener)
					Object.defineProperty(prototype, "addEventListener", listener);
				else delete prototype.addEventListener;
			},
		};
		window.__rocutBackpressureFault = state;
		Object.defineProperty(prototype, "encodeQueueSize", {
			...queue,
			get() {
				return 4;
			},
		});
		prototype.addEventListener = function (type, callback, options) {
			if (type === "dequeue") {
				state.blocked++;
				return;
			}
			return add.call(this, type, callback, options);
		};
	});
	let id,
		terminal = false;
	try {
		const started = await request("api/export", {
			format: "mp4",
			quality: "high",
			includeAudio: true,
			range: { startTime: 478 * 120000, endTime: 480 * 120000 },
		});
		assert.equal(started.status, 202);
		id = started.body.id;
		await expect
			.poll(
				() => page.evaluate(() => window.__rocutBackpressureFault.blocked),
				{ timeout: 30000 },
			)
			.toBeGreaterThan(0);
		assert.equal((await get(id)).status, "running");
		onPhase(
			"cancel a real installed export while native backpressure cannot resolve",
		);
		const startedAt = performance.now();
		const acknowledgement = await request("api/export/" + id + "/cancel");
		assert.equal(acknowledgement.status, 200);
		let job;
		await expect
			.poll(
				async () => {
					job = await get(id);
					return job.status;
				},
				{ timeout: 5000, intervals: [10, 25, 50] },
			)
			.toBe("cancelled");
		terminal = true;
		const milliseconds = performance.now() - startedAt;
		assert(milliseconds <= 1000, "Cancellation exceeded 1000 ms");
		assert.equal(job.outputPath, undefined);
		evidence.checks.push({
			name: "blocked native encoder cancellation settles within one second without a published output",
			milliseconds,
			pass: true,
		});
	} finally {
		await page.evaluate(() => {
			window.__rocutBackpressureFault?.restore();
			delete window.__rocutBackpressureFault;
		});
		if (id && !terminal) {
			await request("api/export/" + id + "/cancel");
			await expect
				.poll(
					async () =>
						["cancelled", "completed", "failed"].includes(
							(await get(id)).status,
						),
					{ timeout: 10000 },
				)
				.toBe(true);
		}
	}
	onPhase(
		"retry a normal 1080p audio export after stalled-encoder cancellation",
	);
	const retry = await request("api/export", {
		format: "mp4",
		quality: "high",
		includeAudio: true,
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
				{ timeout: 120000 },
			)
			.toBe(true);
		assert.equal(job.status, "completed", job.error);
	} finally {
		if (!job || !["completed", "failed", "cancelled"].includes(job.status)) {
			await request("api/export/" + retry.body.id + "/cancel");
			await expect
				.poll(
					async () =>
						["cancelled", "completed", "failed"].includes(
							(await get(retry.body.id)).status,
						),
					{ timeout: 10000 },
				)
				.toBe(true);
		}
	}
	const metadata = JSON.parse(
		execFileSync(
			"ffprobe",
			[
				"-v",
				"error",
				"-count_frames",
				"-show_streams",
				"-of",
				"json",
				job.outputPath,
			],
			{ encoding: "utf8", windowsHide: true, timeout: 30000 },
		),
	);
	const videos = metadata.streams.filter((s) => s.codec_type === "video");
	assert.equal(videos.length, 1);
	assert.equal(videos[0].width, 1920);
	assert.equal(videos[0].height, 1080);
	assert.equal(videos[0].nb_read_frames, "60");
	assert.equal(
		metadata.streams.filter((s) => s.codec_type === "audio").length,
		1,
	);
	evidence.checks.push({
		name: "normal export after fault cleanup decodes 60 1080p frames plus audio",
		pass: true,
	});
}
