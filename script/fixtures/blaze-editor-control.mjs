import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { blazeEditorContract as contract } from "./blaze-editor-contract.mjs";

export const blazeEditorDigest = (value) =>
	createHash("sha256").update(value).digest("hex");
export const blazeEditorById = (items) =>
	[...items].sort((a, b) => a.id.localeCompare(b.id));
export const blazeEditorWrite = (root, file, value) =>
	writeFile(
		join(root, file),
		typeof value === "string" || Buffer.isBuffer(value)
			? value
			: JSON.stringify(value, null, 2) + "\n",
		{ encoding: "utf8", flag: "wx" },
	);

export async function blazeEditorPoll(check, timeout = 30000) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		const value = await check();
		if (value) return value;
		await new Promise((done) => setTimeout(done, 100));
	}
	throw Error("Blaze editor observation deadline exceeded");
}

export function blazeEditorRequest(editorUrl) {
	return async (route, body) => {
		const response = await fetch(new URL(`api/${route}`, editorUrl), {
			signal: AbortSignal.timeout(15000),
			...(body === undefined
				? {}
				: {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(body),
					}),
		});
		const value = await response.json();
		const expectedStatus =
			route === "editor-tasks" && body !== undefined ? 202 : 200;
		assert.equal(
			response.status,
			expectedStatus,
			`${route}: ${JSON.stringify(value)}`,
		);
		return value;
	};
}

export async function blazeEditorSnapshot(request) {
	return {
		clips: blazeEditorById(await request("clips")),
		tracks: blazeEditorById(await request("tracks")),
		revision: (await request("context")).revision,
	};
}

export function blazeEditorTimecode(ticks) {
	assert(
		Number.isSafeInteger(ticks) &&
			ticks >= 0 &&
			ticks % contract.ticksPerFrame === 0,
	);
	const totalFrames = ticks / contract.ticksPerFrame;
	const frames = totalFrames % 30,
		seconds = Math.floor(totalFrames / 30) % 60;
	const minutes = Math.floor(totalFrames / 1800) % 60,
		hours = Math.floor(totalFrames / 108000);
	return [hours, minutes, seconds, frames]
		.map((value) => String(value).padStart(2, "0"))
		.join(":");
}

export async function blazeEditorSeek(page, ticks) {
	const expected = blazeEditorTimecode(ticks);
	await page
		.getByRole("button", { name: "Edit playhead time", exact: true })
		.click();
	const input = page.getByRole("textbox", {
		name: "Playhead time",
		exact: true,
	});
	await input.fill(expected);
	await input.press("Enter");
	await blazeEditorPoll(
		async () =>
			(
				await page
					.getByRole("button", { name: "Edit playhead time", exact: true })
					.innerText()
			).trim() === expected,
	);
	return { ticks, timecode: expected, mechanism: "actual playhead time input" };
}

export function blazeEditorHistory(request) {
	return async (kind, key) => {
		assert(["history.status", "history.undo", "history.redo"].includes(kind));
		const expectedRequest = {
			kind,
			expectedRevision: (await request("context")).revision,
			idempotencyKey: key,
		};
		const started = await request("editor-tasks", {
			request: expectedRequest,
		});
		assert(
			typeof started.id === "string" && /^[a-zA-Z0-9_-]+$/.test(started.id),
		);
		assert(
			typeof started.surfaceId === "string" && started.surfaceId.length > 0,
		);
		const validate = (job) => {
			assert.equal(job.id, started.id, "Editor task identity changed");
			assert.equal(
				job.surfaceId,
				started.surfaceId,
				"Editor task surface changed",
			);
			assert.deepEqual(
				job.request,
				expectedRequest,
				"Editor task request changed",
			);
			assert(
				[
					"running",
					"complete",
					"failed",
					"cancelled",
					"outcome-unknown",
				].includes(job.status),
				`Invalid editor task status: ${JSON.stringify(job)}`,
			);
			return job.status === "running" ? null : job;
		};
		const job =
			validate(started) ??
			(await blazeEditorPoll(async () =>
				validate(await request(`editor-tasks/${started.id}`)),
			));
		assert.equal(job.status, "complete", JSON.stringify(job));
		assert.equal(job.error, undefined, JSON.stringify(job));
		assert(
			Object.hasOwn(job, "result") && job.result !== undefined,
			JSON.stringify(job),
		);
		return job.result;
	};
}

export async function blazeEditorScreenshot(page, root, name) {
	const bytes = await page.screenshot();
	await blazeEditorWrite(root, name + ".png", bytes);
	return {
		name,
		sha256: blazeEditorDigest(bytes),
		bytes: bytes.length,
		purpose: "UI audit only; not a pixel oracle",
	};
}
