import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "@playwright/test";

// Host API orchestration with the real attached surface; not export-button UI acceptance.
export async function probeExportRecovery(frame, project, evidence) {
	const request = (path, body) =>
		frame.evaluate(
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
		frame.evaluate(
			async (id) =>
				(await fetch(new URL("api/export/" + id, location.href))).json(),
			id,
		);
	const list = () =>
		frame.evaluate(async () =>
			(await fetch(new URL("api/export", location.href))).json(),
		);
	const snapshot = () =>
		frame.evaluate(async () => {
			const { record } = await (
				await fetch(new URL("api/record", location.href))
			).json();
			return {
				scenes: record.data.scenes,
				sequences: record.data.motionTextSequences,
				settings: record.data.settings,
			};
		});
	const before = await snapshot();
	const options = { format: "mp4", quality: "high", includeAudio: true };
	await expect.poll(async () => (await list()).surfaces).toBe(1);
	const started = await request("api/export", options);
	assert.equal(started.status, 202);
	const id = started.body.id;
	await expect
		.poll(async () => (await get(id)).status, {
			timeout: 30000,
			intervals: [20, 50, 100],
		})
		.toBe("running");
	const cancellation = await request("api/export/" + id + "/cancel");
	assert.equal(cancellation.status, 200);
	assert.equal(cancellation.body.cancelRequested, true);
	let job;
	await expect
		.poll(
			async () => {
				job = await get(id);
				return ["completed", "failed", "cancelled"].includes(job.status);
			},
			{ timeout: 30000 },
		)
		.toBe(true);
	evidence.checks.push({
		name: "cancelled export terminal state",
		status: job.status,
		error: job.error,
	});
	assert.equal(
		job.status,
		"cancelled",
		"Cancellation must not be reported as an encoder failure",
	);
	assert.equal(job.outputPath, undefined);
	const files = await readdir(join(project, "exports")).catch((error) => {
		if (error.code === "ENOENT") return [];
		throw error;
	});
	assert(
		!files.some((name) => name.includes(id)),
		"Cancelled job must leave no output or partial file",
	);
	assert.deepEqual(
		await snapshot(),
		before,
		"Export cancellation must not mutate the timeline",
	);
	evidence.checks.push({
		name: "running export cancellation settles without output or project mutation",
		pass: true,
	});
	// An out-of-timeline range is syntactically valid; the actual renderer must
	// report the failure, release its busy state, and permit the next valid job.
	const failed = await request("api/export", {
		...options,
		range: { startTime: 120000000, endTime: 120120000 },
	});
	assert.equal(failed.status, 202);
	let failedJob;
	await expect
		.poll(
			async () => {
				failedJob = await get(failed.body.id);
				return ["completed", "failed", "cancelled"].includes(failedJob.status);
			},
			{ timeout: 30000 },
		)
		.toBe(true);
	assert.equal(failedJob.status, "failed");
	assert.equal(failedJob.outputPath, undefined);
	assert.equal(
		failedJob.error,
		"Invalid timeline range: the range end exceeds the timeline duration.",
		"Range failure must come from Rust validation, not an unrelated encoder failure",
	);
	assert.deepEqual(await snapshot(), before);
	evidence.checks.push({
		name: "invalid export range fails in real renderer without project mutation",
		pass: true,
	});
	// Caller follows with probeMixedExport to independently decode the retry.
}
