import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "@playwright/test";
import {
	attachAudioOutputObserver,
	observeAudioPlayback,
} from "./probe-audio-format-output.mjs";

export async function probeMediaMime({
	page,
	hostPage,
	work,
	evidence,
	onPhase,
	preparePlayback,
	reopenAudio = false,
}) {
	const entries = [];
	for (const [extension, kind, mime, args] of [
		[
			"mp4",
			"video",
			"video/mp4",
			[
				"-f",
				"lavfi",
				"-i",
				"color=c=red:s=320x180:r=30:d=2",
				"-c:v",
				"libx264",
				"-pix_fmt",
				"yuv420p",
			],
		],
		[
			"wav",
			"audio",
			"audio/wav",
			[
				"-f",
				"lavfi",
				"-i",
				"sine=frequency=880:duration=2",
				"-c:a",
				"pcm_s16le",
			],
		],
		[
			"png",
			"image",
			"image/png",
			["-f", "lavfi", "-i", "color=c=red:s=320x180", "-frames:v", "1"],
		],
	]) {
		const path = join(work, "mime-source." + extension);
		execFileSync("ffmpeg", ["-v", "error", "-n", ...args, path], {
			windowsHide: true,
		});
		for (const [label, type] of [
			["empty", ""],
			["generic", "application/octet-stream"],
		]) {
			const name = label + " 兼容." + extension.toUpperCase();
			entries.push({ name, kind, mime, type, buffer: readFileSync(path) });
		}
	}
	const attachments = () =>
		page.evaluate(async () =>
			(await fetch(new URL("api/attachments", location.href))).json(),
		);
	const clips = () =>
		page.evaluate(async () => {
			const tracks = (
				await (await fetch(new URL("api/record", location.href))).json()
			).record.data.scenes[0].tracks;
			return [tracks.main, ...tracks.overlay, ...tracks.audio].flatMap(
				(t) => t.elements,
			);
		});
	const choose = async (files) => {
		const choosing = hostPage.waitForEvent("filechooser");
		await page.getByLabel("Import media", { exact: true }).click();
		await (await choosing).setFiles(files);
		await expect(page.getByLabel("Import media", { exact: true })).toBeEnabled({
			timeout: 60000,
		});
	};
	onPhase("empty and generic MIME import through real file chooser");
	evidence.mimeAudioMode = reopenAudio
		? "reopen-after-insertion"
		: "direct-first-play";
	await page.getByLabel("Media", { exact: true }).click();
	// Playwright infers a MIME when its payload specifies an empty string. At the
	// file-input boundary, model the empty File.type emitted by some OS pickers.
	// Keep the actual chooser event, bytes and application handlers unchanged.
	await page.evaluate(() => {
		globalThis.__mimeInputs = [];
		document.addEventListener(
			"change",
			(event) => {
				if (
					!(event.target instanceof HTMLInputElement) ||
					event.target.type !== "file"
				)
					return;
				const transfer = new DataTransfer();
				for (const file of event.target.files ?? [])
					transfer.items.add(
						file.name.startsWith("empty ")
							? new File([file], file.name, {
									type: "",
									lastModified: file.lastModified,
								})
							: file,
					);
				event.target.files = transfer.files;
				globalThis.__mimeInputs.push(
					...Array.from(event.target.files, (file) => ({
						name: file.name,
						type: file.type,
					})),
				);
			},
			true,
		);
	});
	await choose(
		entries.map((e) => ({ name: e.name, mimeType: e.type, buffer: e.buffer })),
	);
	evidence.mimeInputs = await page.evaluate(() => globalThis.__mimeInputs);
	assert.deepEqual(
		evidence.mimeInputs,
		entries.map((e) => ({ name: e.name, type: e.type })),
		"The real browser File objects must have the intended MIME values",
	);
	const stored = await attachments();
	assert.equal(
		stored.length,
		entries.length,
		"Missing/generic MIME media must import, not be rejected as unsupported",
	);
	for (const entry of entries) {
		const item = stored.find((i) => i.metadata.name === entry.name);
		assert(item, entry.name);
		assert.equal(item.metadata.type, entry.kind);
		assert.equal(item.metadata.mimeType, entry.mime);
		const hash = await page.evaluate(async (key) => {
			const bytes = await (
				await fetch(
					new URL("api/attachment/" + encodeURIComponent(key), location.href),
				)
			).arrayBuffer();
			return Array.from(
				new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
				(x) => x.toString(16).padStart(2, "0"),
			).join("");
		}, item.key);
		assert.equal(hash, createHash("sha256").update(entry.buffer).digest("hex"));
	}
	evidence.checks.push({
		name: "Empty and generic MIME inputs normalize to media MIME without changing names or bytes",
		pass: true,
	});
	await page.reload();
	await page.getByLabel("Media", { exact: true }).click();
	await attachAudioOutputObserver(page);
	for (const entry of entries) {
		onPhase("MIME media reopen and decoded preview: " + entry.name);
		await page.getByLabel("Edit playhead time", { exact: true }).click();
		await page.getByLabel("Playhead time", { exact: true }).fill("00:00:00:00");
		await page.getByLabel("Playhead time", { exact: true }).press("Enter");
		await page
			.getByLabel("Add " + entry.name + " to timeline", { exact: true })
			.click();
		await expect.poll(async () => (await clips()).length).toBe(1);
		await page.getByTestId("timeline-clip").click();
		if (entry.kind === "audio") {
			if (reopenAudio) {
				await page.reload();
				await page.getByTestId("timeline-clip").click();
				await attachAudioOutputObserver(page);
			}
			await preparePlayback();
			await observeAudioPlayback(page);
		} else
			await expect
				.poll(
					async () => {
						const png = await page.locator("canvas").first().screenshot();
						return page.evaluate(async (bytes) => {
							const image = await createImageBitmap(
								new Blob([new Uint8Array(bytes)], { type: "image/png" }),
							);
							const canvas = new OffscreenCanvas(image.width, image.height),
								context = canvas.getContext("2d");
							context.drawImage(image, 0, 0);
							image.close();
							const p = context.getImageData(
								Math.floor(canvas.width / 2),
								Math.floor(canvas.height / 2),
								1,
								1,
							).data;
							return p[0] > 180 && p[1] < 65 && p[2] < 65;
						}, Array.from(png));
					},
					{ timeout: 15000 },
				)
				.toBe(true);
		evidence.checks.push({
			name: entry.name + " reopens and decodes through actual timeline preview",
			pass: true,
		});
		await page.getByLabel("Delete element", { exact: true }).click();
		await expect.poll(async () => (await clips()).length).toBe(0);
		await page.getByLabel("Media", { exact: true }).click();
	}
	onPhase(
		"MIME fallback does not bypass actual decoder or explicit content type",
	);
	const valid = entries.find((e) => e.kind === "video");
	await choose([
		{
			name: "broken.mp4",
			mimeType: "application/octet-stream",
			buffer: Buffer.from("not a media container"),
		},
		{
			name: "unknown.bin",
			mimeType: "application/octet-stream",
			buffer: valid.buffer,
		},
		{ name: "explicit-html.mp4", mimeType: "text/html", buffer: valid.buffer },
	]);
	assert.deepEqual(
		await attachments(),
		stored,
		"Rejected inputs must not create orphan attachments or alter existing assets",
	);
	evidence.checks.push({
		name: "Corrupt media, unknown extensions and explicit non-media MIME remain rejected",
		pass: true,
	});
	await page.screenshot({ path: join(work, "mime-import-complete.png") });
}
