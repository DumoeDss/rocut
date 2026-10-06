import assert from "node:assert/strict";
import console from "node:console";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { fileURLToPath, URL } from "node:url";
import { chromium, expect } from "@playwright/test";

const work = await mkdtemp(join(tmpdir(), "rocut-sound-preview-"));
const fixture = fileURLToPath(
	new URL(
		"../packages/editor-classic/src/sounds/__tests__/browser.html",
		import.meta.url,
	),
).replaceAll("\\", "/");
// Self-generated mono PCM, no provider, private media or paid calls.
const rate = 8000,
	frames = rate * 60;
const wav = Buffer.alloc(44 + frames * 2);
wav.write("RIFF");
wav.writeUInt32LE(wav.length - 8, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(rate, 24);
wav.writeUInt32LE(rate * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(frames * 2, 40);
for (let i = 0; i < frames; i++)
	wav.writeInt16LE(
		Math.round(1000 * Math.sin((2 * Math.PI * 440 * i) / rate)),
		44 + i * 2,
	);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 750 } });
const evidence = {
	kind: "native-sound-preview-lifecycle-component-regression",
	installedAcceptance: false,
	checks: [],
	errors: [],
	consoleErrors: [],
};
page.on("pageerror", (error) => evidence.errors.push(error.message));
page.on("console", (message) => {
	if (message.type() === "error") evidence.consoleErrors.push(message.text());
});
try {
	await page.addInitScript(() => {
		const NativeAudio = window.Audio;
		const audios = [];
		window.Audio = class extends NativeAudio {
			constructor(src) {
				super(src);
				this.volume = 0;
				audios.push(this);
			}
		};
		window.__soundPreviewAudit = () =>
			audios.map((audio) => ({
				paused: audio.paused,
				src: audio.getAttribute("src"),
				time: audio.currentTime,
				ready: audio.readyState,
			}));
	});
	await page.route("**/fixture-preview.wav", (route) =>
		route.fulfill({ contentType: "audio/wav", body: wav }),
	);
	await page.route("**/fixture-sounds?**", (route) =>
		route.fulfill({
			json: {
				results: [1, 2].map((id) => ({
					id,
					name: `Fixture sound ${id}`,
					username: "Fixture",
					duration: 5, // Deliberately wrong provider metadata: use decoded duration.
					tags: [],
					license: "fixture",
					previewUrl: "http://127.0.0.1:4196/fixture-preview.wav",
				})),
				count: 2,
				next: null,
			},
		}),
	);
	await page.goto(`http://127.0.0.1:4196/@fs/${fixture}`);
	await page.getByRole("button", { name: "Toggle panel" }).click();
	const play = (id) =>
		page
			.getByRole("button", { name: `Fixture sound ${id} Fixture`, exact: true })
			.click();
	const audit = () => page.evaluate(() => window.__soundPreviewAudit());
	const active = async () =>
		(await audit()).filter((item) => !item.paused).length;
	const released = async () =>
		(await audit()).every((item) => item.paused && item.src === null);
	await play(1);
	await expect.poll(active).toBe(1);
	await expect.poll(async () => (await audit())[0].time).toBeGreaterThan(0);
	await page.getByRole("button", { name: "Toggle mount" }).click();
	await expect.poll(released).toBe(true);
	evidence.checks.push({
		name: "Unmount stops an actually advancing native audio and clears its source",
		pass: true,
	});
	await page.getByRole("button", { name: "Toggle mount" }).click();
	await play(1);
	await expect.poll(active).toBe(1);
	await play(2);
	await expect.poll(active).toBe(1);
	assert(
		(await audit())
			.slice(0, -1)
			.every((item) => item.paused && item.src === null),
	);
	await play(2);
	await expect.poll(released).toBe(true);
	evidence.checks.push({
		name: "Replacement and toggle-stop release previous native sources",
		pass: true,
	});
	await play(1);
	await expect.poll(active).toBe(1);
	await page.getByRole("button", { name: "Suspend session" }).click();
	await expect.poll(released).toBe(true);
	await page.getByRole("button", { name: "Resume session" }).click();
	assert.equal(await active(), 0);
	evidence.checks.push({
		name: "Session suspension stops preview and resume does not autoplay",
		pass: true,
	});
	await play(1);
	await expect.poll(active).toBe(1);
	await page.getByTitle("Save sound", { exact: true }).first().click();
	await expect(page.getByTestId("saved-count")).toHaveText("1");
	await page.getByRole("tab", { name: "Saved", exact: true }).click();
	await expect.poll(released).toBe(true);
	evidence.checks.push({
		name: "Leaving sound-effects tab stops playback",
		pass: true,
	});
	await play(1);
	await expect.poll(active).toBe(1);
	await page.getByRole("tab", { name: "Sound effects", exact: true }).click();
	await expect.poll(released).toBe(true);
	evidence.checks.push({
		name: "Leaving Saved also releases its native preview",
		pass: true,
	});
	await page.getByRole("button", { name: "Create project" }).click();
	await expect(page.getByTestId("project-ready")).toHaveText("true");
	await page.getByTitle("Add to timeline", { exact: true }).first().click();
	await expect(page.getByTestId("audio-names")).toHaveText(
		'["Fixture sound 1"]',
	);
	evidence.checks.push({
		name: "Actual Add-to-timeline button inserts decoded fixture audio",
		pass: true,
	});
	await page
		.getByRole("button", { name: "Undo insertion", exact: true })
		.click();
	await expect(page.getByTestId("audio-names")).toHaveText("[]");
	await page
		.getByRole("button", { name: "Redo insertion", exact: true })
		.click();
	await expect(page.getByTestId("audio-names")).toHaveText(
		'["Fixture sound 1"]',
	);
	evidence.checks.push({
		name: "Sound insertion supports actual undo and redo",
		pass: true,
	});
	// A reopened project must depend on its attachment, not a still-working provider.
	await page.route("**/fixture-preview.wav", (route) => route.abort());
	await page
		.getByRole("button", { name: "Reopen project", exact: true })
		.click();
	await expect(page.getByTestId("reopened")).toHaveText("true");
	await expect(page.getByTestId("audio-names")).toHaveText(
		'["Fixture sound 1"]',
	);
	await page
		.getByRole("button", { name: "Audit media bytes", exact: true })
		.click();
	await expect(page.getByTestId("media-audit")).toHaveText(
		JSON.stringify([
			{
				type: "audio",
				duration: 60,
				size: wav.length,
				sha256: createHash("sha256").update(wav).digest("hex"),
			},
		]),
	);
	evidence.checks.push({
		name: "Reopen without provider retains exact audio bytes and decoded duration",
		pass: true,
	});
	await page.unroute("**/fixture-preview.wav");
	await page.route("**/fixture-preview.wav", (route) =>
		route.fulfill({ contentType: "audio/wav", body: wav }),
	);
	await page.getByRole("tab", { name: "Saved", exact: true }).click();
	await play(1);
	await expect.poll(active).toBe(1);
	await page.getByRole("button", { name: "Clear all", exact: true }).click();
	await page
		.getByRole("button", { name: "Clear all sounds", exact: true })
		.click();
	await expect(page.getByTestId("saved-count")).toHaveText("0");
	await expect.poll(released).toBe(true);
	evidence.checks.push({
		name: "Clear-all confirmation works and releases the removed Saved preview",
		pass: true,
	});
	await page.getByRole("tab", { name: "Sound effects", exact: true }).click();
	await play(1);
	await expect.poll(active).toBe(1);
	await page.getByRole("button", { name: "Toggle endpoint" }).click();
	await expect.poll(released).toBe(true);
	evidence.checks.push({
		name: "Removing visible search sources stops orphaned preview",
		pass: true,
	});
	assert.deepEqual(evidence.errors, []);
	assert.deepEqual(evidence.consoleErrors, []);
	evidence.audio = await audit();
	evidence.passed = true;
} catch (error) {
	evidence.passed = false;
	evidence.failure = String(error.stack);
	evidence.diagnosticText = await page.locator("body").innerText();
	await page.screenshot({ path: join(work, "failure.png") }).catch(() => {});
	process.exitCode = 1;
} finally {
	await writeFile(
		join(work, "evidence.json"),
		JSON.stringify(evidence, null, 2),
	);
	await browser.close();
	console.log(
		JSON.stringify({
			work,
			passed: evidence.passed,
			checks: evidence.checks.length,
			errors: evidence.errors,
			consoleErrors: evidence.consoleErrors,
			diagnosticText: evidence.diagnosticText,
			failure: evidence.failure,
		}),
	);
}
