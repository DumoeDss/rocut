#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import { createServer } from "vite";

import {
	MOTION_TEXT_F01_COMMITTED_FIRST_CUE_TEXT,
	MOTION_TEXT_F01_FIRST_CUE_TEXT,
	MOTION_TEXT_F01_SOURCE,
} from "./fixtures/motion-text-f01-fixture.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VITE_ROOT = join(ROOT, "apps/vite-example");
// Canonical is the default so the probe never silently measures a stale copy.
// `MOTION_TEXT_UI_INSTALLED=1` drops the alias and exercises whatever the normal
// dependency resolution installs, which is the only way to close the delivery
// gate that the canonical-only run deliberately cannot speak for.
const USE_INSTALLED_WASM = process.env.MOTION_TEXT_UI_INSTALLED === "1";
const WASM_ENTRY = USE_INSTALLED_WASM ? "installed" : "canonical-alias";
const VIDEO_FIXTURE = join(
	ROOT,
	"apps/vite-example/tests/fixtures/fixture-video.mp4",
);
const MOTION_TEXT_CLIP_NAME = "Clean caption";
const MOTION_TEXT_CLIP_PATTERN = /^Clean caption(?: \((?:left|right)\))?$/u;
const AUDIO_FIXTURE_NAME = "motion-text-click-track.wav";
const server = await createServer({
	root: VITE_ROOT,
	configFile: join(VITE_ROOT, "vite.config.ts"),
	logLevel: "error",
	...(USE_INSTALLED_WASM
		? {}
		: {
				resolve: {
					alias: {
						"opencut-wasm": join(ROOT, "rust/wasm/pkg/opencut_wasm.js"),
					},
				},
			}),
	server: { host: "127.0.0.1", port: 0, strictPort: false },
});

let browser;
try {
	await server.listen();
	const address = server.httpServer?.address();
	if (
		address === null ||
		typeof address === "string" ||
		address === undefined
	) {
		throw new Error("Vite did not expose a local port");
	}

	browser = await chromium.launch({
		headless: true,
		args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
	});
	const page = await browser.newPage({
		viewport: { width: 1280, height: 800 },
	});
	const pageErrors = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") pageErrors.push(message.text());
	});

	await page.goto(`http://127.0.0.1:${address.port}/`, {
		waitUntil: "domcontentloaded",
	});
	await page.getByRole("button", { name: "New project" }).click();
	await page
		.getByRole("button", { name: "Motion text" })
		.waitFor({ timeout: 15_000 });
	const editorUrl = page.url();
	const projectId = new URL(editorUrl).searchParams.get("project");
	if (!projectId)
		throw new Error("New project navigation did not expose its id");
	const [videoChooser] = await Promise.all([
		page.waitForEvent("filechooser"),
		page
			.locator(
				'button:has-text("Drag and drop videos, photos, and audio files here")',
			)
			.first()
			.click(),
	]);
	await videoChooser.setFiles(VIDEO_FIXTURE);
	const videoCard = page
		.locator("div.group")
		.filter({ has: page.locator('[title="fixture-video.mp4"]') })
		.first();
	await videoCard.waitFor({ timeout: 15_000 });
	const setPlayheadSeconds = async (seconds) => {
		await page.locator('button[title="Click to edit time"]').first().click();
		const timecodeInput = page.locator("input.font-mono.tabular-nums").first();
		await timecodeInput.fill(`00:00:${String(seconds).padStart(2, "0")}:00`);
		await timecodeInput.press("Enter");
		await page.waitForTimeout(150);
	};
	const setPlayheadTicks = async (ticks) => {
		const frame = Math.round((ticks * 30) / 120_000);
		const hours = Math.floor(frame / (30 * 60 * 60));
		const minutes = Math.floor(frame / (30 * 60)) % 60;
		const seconds = Math.floor(frame / 30) % 60;
		const frames = frame % 30;
		await page.locator('button[title="Click to edit time"]').first().click();
		const timecodeInput = page.locator("input.font-mono.tabular-nums").first();
		await timecodeInput.fill(
			[hours, minutes, seconds, frames]
				.map((value) => String(value).padStart(2, "0"))
				.join(":"),
		);
		await timecodeInput.press("Enter");
		await page.waitForTimeout(150);
	};
	const readPlayheadTicks = async () => {
		const text = await page
			.locator('button[title="Click to edit time"]')
			.first()
			.innerText();
		const match = text.match(/(\d{2}):(\d{2}):(\d{2}):(\d{2})/u);
		if (!match) throw new Error(`Could not parse playhead timecode: ${text}`);
		const [, hours, minutes, seconds, frames] = match.map(Number);
		return (
			(hours * 60 * 60 + minutes * 60 + seconds) * 120_000 +
			Math.round((frames * 120_000) / 30)
		);
	};
	for (let index = 0; index < 3; index += 1) {
		if (index > 0) await setPlayheadSeconds(index * 5);
		await videoCard.hover();
		await videoCard.locator("button").first().click();
		await page.waitForTimeout(250);
	}
	await setPlayheadSeconds(0);
	await page.locator('input[type="file"]').setInputFiles({
		name: AUDIO_FIXTURE_NAME,
		mimeType: "audio/wav",
		buffer: buildClickTrackWav({ durationSeconds: 30, sampleRate: 8_000 }),
	});
	const audioCard = page
		.locator("div.group")
		.filter({ has: page.locator(`[title="${AUDIO_FIXTURE_NAME}"]`) })
		.first();
	await audioCard.waitFor({ timeout: 15_000 });
	await audioCard.hover();
	await audioCard.locator("button").first().click();
	await page.waitForTimeout(250);
	await page.getByRole("button", { name: "Motion text" }).click();

	const source = page.getByLabel("Lines");
	await source.fill(MOTION_TEXT_F01_SOURCE);
	await source.dispatchEvent("compositionstart");
	await source.press("Control+Enter");
	await page.waitForTimeout(150);
	assert.equal(
		await page
			.locator("span.truncate.text-xs.text-white")
			.filter({ hasText: MOTION_TEXT_CLIP_PATTERN })
			.count(),
		0,
	);
	await source.dispatchEvent("compositionend");
	await source.press("Control+Enter");
	await page
		.getByRole("heading", { name: "Sequence defaults" })
		.waitFor({ timeout: 10_000 });
	await page.getByText("r0", { exact: true }).waitFor();
	await page.getByText("12 cues", { exact: true }).waitFor();
	const starterSection = page
		.getByRole("heading", { name: "Starter style" })
		.last()
		.locator("xpath=ancestor::section[1]");
	await setPlayheadSeconds(1);
	const candidatePreviewCanvas = page.locator("canvas:visible").first();
	await candidatePreviewCanvas.waitFor();
	await page.waitForTimeout(500);
	const starterBaseFrame = await candidatePreviewCanvas.screenshot({
		type: "png",
	});
	await starterSection.getByRole("button", { name: /Impact title/iu }).click();
	await starterSection.getByText("Preview only", { exact: true }).waitFor();
	await page.waitForTimeout(500);
	const starterCandidateFrame = await candidatePreviewCanvas.screenshot({
		type: "png",
	});
	assert.equal(starterCandidateFrame.equals(starterBaseFrame), false);

	const cueRows = () =>
		page.locator(
			'section[aria-labelledby="motion-text-cues-heading"] > div > button',
		);
	await cueRows().first().click();
	const lyric = page.getByLabel("Lyric text");
	assert.equal(await lyric.inputValue(), MOTION_TEXT_F01_FIRST_CUE_TEXT);

	const cueEditor = () =>
		page
			.getByLabel("Lyric text")
			.locator(
				"xpath=ancestor::div[.//button[normalize-space()='Apply changes']][1]",
			);
	await expectDisabled(
		cueEditor().getByRole("button", { name: "Apply changes" }),
	);
	await lyric.fill("\u53d6\u6d88\u4e0d\u5e94\u5199\u5165");
	await expectEnabled(
		cueEditor().getByRole("button", { name: "Apply changes" }),
	);
	await cueEditor().getByRole("button", { name: "Cancel" }).click();
	await page.getByText("r0", { exact: true }).waitFor();
	await cueRows().first().click();
	assert.equal(
		await page.getByLabel("Lyric text").inputValue(),
		MOTION_TEXT_F01_FIRST_CUE_TEXT,
	);

	const committedText = MOTION_TEXT_F01_COMMITTED_FIRST_CUE_TEXT;
	await page.getByLabel("Lyric text").fill(committedText);
	await page.getByLabel("Lyric text").dispatchEvent("compositionstart");
	await page.getByLabel("Lyric text").press("Control+Enter");
	await page.waitForTimeout(150);
	await page.getByText("r0", { exact: true }).waitFor();
	await page.getByLabel("Lyric text").dispatchEvent("compositionend");
	const cueApplyOutcome = Promise.race([
		page
			.getByText("r1", { exact: true })
			.waitFor({ timeout: 0 })
			.then(() => ({ kind: "applied" })),
		cueEditor()
			.getByRole("alert")
			.waitFor({ timeout: 0 })
			.then(async () => ({
				kind: "error",
				message: await cueEditor().getByRole("alert").innerText(),
			})),
		page.waitForTimeout(10_000).then(() => ({ kind: "timeout" })),
	]);
	await page.getByLabel("Lyric text").press("Control+Enter");
	const cueApplyResult = await cueApplyOutcome;
	if (cueApplyResult.kind === "error") throw new Error(cueApplyResult.message);
	if (cueApplyResult.kind === "timeout") {
		throw new Error("Cue apply did not publish a revision or a diagnostic");
	}
	await page.getByLabel("Lyric text").waitFor({ state: "detached" });
	await starterSection
		.getByText("Preview only", { exact: true })
		.waitFor({ state: "detached" });
	await expectDisabled(starterSection.getByRole("button", { name: "Apply" }));

	await cueRows().nth(1).click();
	await page.getByLabel("Start (sec)").fill("0");
	await cueEditor().getByRole("button", { name: "Apply changes" }).click();
	await page
		.getByRole("alert")
		.filter({ hasText: /overlap/iu })
		.waitFor();
	await page.getByText("r1", { exact: true }).waitFor();
	await cueEditor().getByRole("button", { name: "Cancel" }).click();

	await page.getByRole("button", { name: "Edit font and colors" }).click();
	const defaultsEditor = page
		.getByText("Default font", { exact: true })
		.locator(
			"xpath=ancestor::div[.//button[normalize-space()='Apply changes']][1]",
		);
	await expectDisabled(
		defaultsEditor.getByRole("button", { name: "Apply changes" }),
	);
	await defaultsEditor.getByRole("button", { name: "Customize" }).click();
	await expectEnabled(
		defaultsEditor.getByRole("button", { name: "Apply changes" }),
	);
	await defaultsEditor.getByRole("button", { name: "Cancel" }).click();
	await page.getByText("r1", { exact: true }).waitFor();

	await setPlayheadSeconds(1);
	const starterCancelBaseFrame = await candidatePreviewCanvas.screenshot({
		type: "png",
	});
	await starterSection.getByRole("button", { name: /Impact title/iu }).click();
	await starterSection.getByText("Preview only", { exact: true }).waitFor();
	await page.waitForTimeout(500);
	const starterCancelCandidateFrame = await candidatePreviewCanvas.screenshot({
		type: "png",
	});
	assert.equal(
		starterCancelCandidateFrame.equals(starterCancelBaseFrame),
		false,
	);
	await starterSection.getByRole("button", { name: "Cancel" }).click();
	await starterSection
		.getByText("Preview only", { exact: true })
		.waitFor({ state: "detached" });
	await page.getByText("r1", { exact: true }).waitFor();
	await page.waitForTimeout(500);
	const starterCancelRestoredFrame = await candidatePreviewCanvas.screenshot({
		type: "png",
	});
	assert.equal(starterCancelRestoredFrame.equals(starterCancelBaseFrame), true);

	await page.setViewportSize({ width: 1024, height: 768 });
	await page.reload({ waitUntil: "domcontentloaded" });
	const timelineTitle = page
		.locator("span.truncate.text-xs.text-white")
		.filter({ hasText: MOTION_TEXT_CLIP_PATTERN });
	await timelineTitle.waitFor({ timeout: 15_000 });
	await timelineTitle.locator("xpath=ancestor::button[1]").click();
	await page.getByText("r1", { exact: true }).waitFor();
	await cueRows().first().click();
	const reopenedLyric = page.getByLabel("Lyric text");
	assert.equal(await reopenedLyric.inputValue(), committedText);
	await reopenedLyric.scrollIntoViewIfNeeded();
	await reopenedLyric.focus();
	assert.equal(
		await reopenedLyric.evaluate(
			(element) => document.activeElement === element,
		),
		true,
	);
	const lyricBounds = await reopenedLyric.boundingBox();
	assert.ok(lyricBounds !== null && lyricBounds.y >= 0);
	assert.ok(lyricBounds.y + lyricBounds.height <= 768);
	await cueEditor().getByRole("button", { name: "Cancel" }).click();
	await setPlayheadSeconds(1);
	const variationSection = page
		.getByRole("heading", { name: "Variation" })
		.last()
		.locator("xpath=ancestor::section[1]");
	const variationBaseFrame = await candidatePreviewCanvas.screenshot({
		type: "png",
	});
	await variationSection
		.getByRole("button", { name: "Generate variation" })
		.click();
	await variationSection.getByText("Canvas preview", { exact: true }).waitFor();
	await page.getByText("r1", { exact: true }).waitFor();
	await page.waitForTimeout(500);
	const variationCandidateFrame = await candidatePreviewCanvas.screenshot({
		type: "png",
	});
	assert.equal(variationCandidateFrame.equals(variationBaseFrame), false);
	await variationSection.getByRole("button", { name: "Cancel" }).click();
	await variationSection
		.getByText("Canvas preview", { exact: true })
		.waitFor({ state: "detached" });
	await page.getByText("r1", { exact: true }).waitFor();
	await page.waitForTimeout(500);
	const variationRestoredFrame = await candidatePreviewCanvas.screenshot({
		type: "png",
	});
	assert.equal(variationRestoredFrame.equals(variationBaseFrame), true);

	await variationSection
		.getByRole("button", { name: "Generate variation" })
		.click();
	await variationSection.getByText("Canvas preview", { exact: true }).waitFor();
	await variationSection
		.getByRole("button", { name: "Apply variation" })
		.click();
	await page.getByText("r2", { exact: true }).waitFor();
	await variationSection
		.getByText("Canvas preview", { exact: true })
		.waitFor({ state: "detached" });
	await page.waitForTimeout(250);
	await timelineTitle.first().locator("xpath=ancestor::button[1]").click();
	await page.keyboard.press("Control+z");
	await page.getByText("r1", { exact: true }).waitFor();
	await page.keyboard.press("Control+Shift+z");
	await page.getByText("r2", { exact: true }).waitFor();
	const audioAnalysisSection = page
		.getByRole("heading", { name: "Audio analysis" })
		.last()
		.locator("xpath=ancestor::section[1]");
	const audioAlert = page
		.getByRole("alert")
		.filter({ hasText: /audio|WASM|clip|sequence/iu });
	const audioBindOutcome = Promise.race([
		page
			.getByText("r3", { exact: true })
			.waitFor({ timeout: 0 })
			.then(() => ({ kind: "applied" })),
		audioAlert.waitFor({ timeout: 0 }).then(async () => ({
			kind: "error",
			message: await audioAlert.innerText(),
		})),
		page.waitForTimeout(30_000).then(async () => ({
			kind: "timeout",
			panel: await audioAnalysisSection.innerText(),
		})),
	]);
	await audioAnalysisSection
		.getByRole("button", { name: "Analyze and bind" })
		.click();
	const audioBindResult = await audioBindOutcome;
	if (audioBindResult.kind === "error") {
		throw new Error(`Audio binding failed: ${audioBindResult.message}`);
	}
	if (audioBindResult.kind === "timeout") {
		throw new Error(`Audio binding timed out: ${audioBindResult.panel}`);
	}
	await audioAnalysisSection.getByText("BPM 120.0", { exact: true }).waitFor();
	await page.getByLabel("Manual BPM").fill("128");
	await page.getByLabel("First beat (sequence sec)").fill("0.25");
	await page.getByRole("button", { name: "Apply tempo" }).click();
	await page.getByText("r4", { exact: true }).waitFor();
	await timelineTitle.first().locator("xpath=ancestor::button[1]").click();
	await page.keyboard.press("Control+z");
	await page.getByText("r3", { exact: true }).waitFor();
	assert.equal(await page.getByLabel("Manual BPM").inputValue(), "");
	await page.keyboard.press("Control+Shift+z");
	await page.getByText("r4", { exact: true }).waitFor();
	assert.equal(await page.getByLabel("Manual BPM").inputValue(), "128");

	await cueRows().nth(1).click();
	const cutTimingSection = page
		.getByRole("heading", { name: "Cut timing" })
		.locator("xpath=ancestor::section[1]");
	await cutTimingSection.getByLabel("End (sec)").first().fill("1.64");
	await cutTimingSection
		.getByRole("button", { name: "Cut beat snap off" })
		.click();
	await cutTimingSection
		.getByRole("button", { name: "Apply boundary" })
		.first()
		.click();
	await page.getByText("r5", { exact: true }).waitFor();
	assert.equal(
		await cutTimingSection.getByLabel("End (sec)").first().inputValue(),
		"1.656",
	);
	await timelineTitle.first().locator("xpath=ancestor::button[1]").click();
	await page.keyboard.press("Control+z");
	await page.getByText("r4", { exact: true }).waitFor();
	await page.keyboard.press("Control+Shift+z");
	await page.getByText("r5", { exact: true }).waitFor();

	await cueRows().nth(4).click();
	await page.getByLabel("Start (sec)").fill("4.92");
	await page.getByLabel("Duration (sec)").fill("1.10");
	await page.getByRole("button", { name: "Cue beat snap off" }).click();
	await cueEditor().getByRole("button", { name: "Apply changes" }).click();
	await page.getByText("r6", { exact: true }).waitFor();
	await cueRows().nth(4).getByText("Timing manual", { exact: true }).waitFor();
	await cueRows().nth(4).click();
	assert.equal(await page.getByLabel("Start (sec)").inputValue(), "4.94");
	assert.equal(await page.getByLabel("Duration (sec)").inputValue(), "0.94");
	await cueEditor().getByRole("button", { name: "Cancel" }).click();
	await timelineTitle.first().locator("xpath=ancestor::button[1]").click();
	await page.keyboard.press("Control+z");
	await page.getByText("r5", { exact: true }).waitFor();
	await page.keyboard.press("Control+Shift+z");
	await page.getByText("r6", { exact: true }).waitFor();

	await cueRows().nth(10).click();
	await page
		.getByRole("button", { name: "Start tapping from selected cue" })
		.click();
	await page
		.getByRole("button", { name: "Beat snap off", exact: true })
		.click();
	await setPlayheadSeconds(13);
	await page.getByRole("button", { name: "Tap current cue" }).click();
	await setPlayheadSeconds(14);
	await page.getByRole("button", { name: "Tap current cue" }).click();
	await page.getByRole("button", { name: "Undo last tap" }).click();
	await page.getByText("1 recorded", { exact: true }).waitFor();
	await page.getByRole("button", { name: "Tap current cue" }).click();
	await page.getByRole("button", { name: "Apply taps" }).click();
	await page.getByText("r7", { exact: true }).waitFor();
	await cueRows().nth(10).getByText("Timing tap", { exact: true }).waitFor();
	await cueRows().nth(11).getByText("Timing tap", { exact: true }).waitFor();
	await timelineTitle.first().locator("xpath=ancestor::button[1]").click();
	await page.keyboard.press("Control+z");
	await page.getByText("r6", { exact: true }).waitFor();
	await page.keyboard.press("Control+Shift+z");
	await page.getByText("r7", { exact: true }).waitFor();
	const screenshotPath = process.env.MOTION_TEXT_UI_SCREENSHOT;
	if (screenshotPath) {
		await page.screenshot({ path: screenshotPath, fullPage: true });
	}

	const layout = await page.evaluate(() => ({
		documentWidth: document.documentElement.scrollWidth,
		viewportWidth: window.innerWidth,
	}));
	assert.ok(
		layout.documentWidth <= layout.viewportWidth,
		`Motion-text UI overflowed the viewport: ${JSON.stringify(layout)}`,
	);

	const firstClipTitle = timelineTitle.first();
	const firstClipButton = firstClipTitle.locator("xpath=ancestor::button[1]");
	await firstClipButton.click();
	const originalClipBounds = await firstClipButton.boundingBox();
	if (!originalClipBounds) throw new Error("Motion-text clip is not visible");
	const dragStartX =
		originalClipBounds.x + Math.min(100, originalClipBounds.width / 4);
	await page.mouse.move(
		dragStartX,
		originalClipBounds.y + originalClipBounds.height / 2,
	);
	await page.keyboard.down("Shift");
	await page.mouse.down();
	await page.mouse.move(
		dragStartX + 120,
		originalClipBounds.y + originalClipBounds.height / 2,
		{ steps: 8 },
	);
	await page.mouse.up();
	await page.keyboard.up("Shift");
	await page.waitForTimeout(250);
	const movedClipBounds = await firstClipButton.boundingBox();
	assert.ok(
		movedClipBounds && movedClipBounds.x >= originalClipBounds.x + 20,
		`Dragging the motion-text clip did not move it on the timeline: ${JSON.stringify({ originalClipBounds, movedClipBounds })}`,
	);
	await audioAnalysisSection
		.getByText("Audio clip timing changed", { exact: true })
		.waitFor();
	const audioSyncFrameTimes = [12];
	const captureAudioSyncFrames = async () => {
		const frames = [];
		for (const seconds of audioSyncFrameTimes) {
			await setPlayheadSeconds(seconds);
			await page.waitForTimeout(200);
			frames.push(
				await candidatePreviewCanvas.screenshot({
					type: "png",
				}),
			);
		}
		return frames;
	};
	const committedAudioTimingFrames = await captureAudioSyncFrames();
	await audioAnalysisSection
		.getByRole("button", { name: "Preview re-sync" })
		.click();
	const audioTimingPreview = audioAnalysisSection.getByTestId(
		"motion-text-audio-sync-preview",
	);
	await audioTimingPreview.waitFor({ timeout: 30_000 });
	await audioTimingPreview
		.getByText("Project unchanged until apply.", { exact: true })
		.waitFor();
	await page.waitForTimeout(500);
	const candidateAudioTimingFrames = await captureAudioSyncFrames();
	assert.equal(
		candidateAudioTimingFrames.some(
			(frame, index) => !frame.equals(committedAudioTimingFrames[index]),
		),
		true,
		"The audio timing candidate did not change any sampled canvas frame",
	);
	await audioTimingPreview
		.getByRole("button", { name: "Cancel preview" })
		.click();
	await audioTimingPreview.waitFor({ state: "detached" });
	await page.waitForTimeout(500);
	const restoredAudioTimingFrames = await captureAudioSyncFrames();
	const audioSyncCandidateChanged = candidateAudioTimingFrames.map(
		(frame, index) => !frame.equals(committedAudioTimingFrames[index]),
	);
	const audioSyncCancelRestored = restoredAudioTimingFrames.map(
		(frame, index) => frame.equals(committedAudioTimingFrames[index]),
	);
	assert.equal(
		audioSyncCancelRestored.every(Boolean),
		true,
		`Cancelling the audio timing candidate did not restore committed frames: ${JSON.stringify({ audioSyncFrameTimes, audioSyncCandidateChanged, audioSyncCancelRestored })}`,
	);

	await audioAnalysisSection
		.getByRole("button", { name: "Preview re-sync" })
		.click();
	await audioTimingPreview.waitFor({ timeout: 30_000 });
	await audioTimingPreview.getByRole("button", { name: "Apply sync" }).click();
	await page.getByText("r8", { exact: true }).waitFor();
	await audioTimingPreview.waitFor({ state: "detached" });
	await timelineTitle.first().locator("xpath=ancestor::button[1]").click();
	await page.keyboard.press("Control+z");
	await page.getByText("r7", { exact: true }).waitFor();
	await page.keyboard.press("Control+Shift+z");
	await page.getByText("r8", { exact: true }).waitFor();
	await cueRows().nth(4).click();
	assert.equal(await page.getByLabel("Start (sec)").inputValue(), "4.94");
	assert.equal(await page.getByLabel("Duration (sec)").inputValue(), "0.94");
	await cueEditor().getByRole("button", { name: "Cancel" }).click();
	await cueRows().nth(10).getByText("Timing tap", { exact: true }).waitFor();
	await cueRows().nth(11).getByText("Timing tap", { exact: true }).waitFor();

	const leftResizeHandle = page.getByRole("button", {
		name: "Left resize handle",
	});
	const resizeBounds = await leftResizeHandle.boundingBox();
	if (!resizeBounds)
		throw new Error("Motion-text left resize handle is missing");
	await page.mouse.move(
		resizeBounds.x + resizeBounds.width / 2,
		resizeBounds.y + resizeBounds.height / 2,
	);
	await page.mouse.down();
	await page.mouse.move(
		resizeBounds.x + resizeBounds.width / 2 + 96,
		resizeBounds.y + resizeBounds.height / 2,
		{ steps: 8 },
	);
	await page.mouse.up();
	await page.waitForTimeout(250);
	const trimmedClipBounds = await firstClipButton.boundingBox();
	assert.ok(
		trimmedClipBounds &&
			movedClipBounds &&
			trimmedClipBounds.width <= movedClipBounds.width - 40,
		"Dragging the motion-text resize handle did not trim the clip",
	);

	const ruler = page.getByRole("slider", { name: "Timeline ruler" });
	const rulerBounds = await ruler.boundingBox();
	if (!rulerBounds || !trimmedClipBounds) {
		throw new Error("Timeline ruler is unavailable for the split probe");
	}
	await page.mouse.click(
		trimmedClipBounds.x + Math.min(160, trimmedClipBounds.width / 2),
		rulerBounds.y + rulerBounds.height / 2,
	);
	await firstClipButton.click();
	await page.keyboard.press("s");
	try {
		await page.waitForFunction(
			(name) =>
				[
					...document.querySelectorAll("span.truncate.text-xs.text-white"),
				].filter((element) => element.textContent?.trim().startsWith(name))
					.length === 2,
			MOTION_TEXT_CLIP_NAME,
			{ timeout: 5_000 },
		);
	} catch {
		throw new Error(
			`Splitting the selected motion-text clip failed: ${JSON.stringify(await page.locator("span.truncate.text-xs.text-white").allTextContents())}`,
		);
	}
	await page.keyboard.press("Control+z");
	await page.waitForFunction(
		(name) =>
			[...document.querySelectorAll("span.truncate.text-xs.text-white")].filter(
				(element) => element.textContent?.trim().startsWith(name),
			).length === 1,
		MOTION_TEXT_CLIP_NAME,
	);
	await page.keyboard.press("Control+Shift+z");
	await page.waitForFunction(
		(name) =>
			[...document.querySelectorAll("span.truncate.text-xs.text-white")].filter(
				(element) => element.textContent?.trim().startsWith(name),
			).length === 2,
		MOTION_TEXT_CLIP_NAME,
	);
	const selectVisibleCueRange = async ({ clipIndex, cueIndex } = {}) => {
		const firstClipIndex = clipIndex ?? 0;
		const lastClipIndex = clipIndex ?? (await timelineTitle.count()) - 1;
		for (
			let candidateClipIndex = firstClipIndex;
			candidateClipIndex <= lastClipIndex;
			candidateClipIndex += 1
		) {
			await timelineTitle
				.nth(candidateClipIndex)
				.locator("xpath=ancestor::button[1]")
				.click();
			await cueRows().first().waitFor();
			const firstCueIndex = cueIndex ?? 0;
			const lastCueIndex = cueIndex ?? (await cueRows().count()) - 1;
			for (
				let candidateCueIndex = firstCueIndex;
				candidateCueIndex <= lastCueIndex;
				candidateCueIndex += 1
			) {
				await cueRows().nth(candidateCueIndex).click();
				const controls = page.locator('[data-motion-text-cue-range="true"]');
				if ((await controls.count()) === 0) continue;
				const startTime = Number(
					await controls.getAttribute("data-range-start"),
				);
				const endTime = Number(await controls.getAttribute("data-range-end"));
				if (
					Number.isSafeInteger(startTime) &&
					Number.isSafeInteger(endTime) &&
					endTime - startTime >= 60_000
				) {
					return {
						clipIndex: candidateClipIndex,
						cueIndex: candidateCueIndex,
						startTime,
						endTime,
					};
				}
			}
		}
		throw new Error(
			"No split clip contains a cue range of at least 0.5 seconds",
		);
	};
	const selectedCueRange = await selectVisibleCueRange();
	const cueRangeStart = selectedCueRange.startTime;
	const cueRangeEnd = selectedCueRange.endTime;
	assert.ok(Number.isSafeInteger(cueRangeStart));
	assert.ok(Number.isSafeInteger(cueRangeEnd));
	assert.ok(cueRangeEnd > cueRangeStart);
	await page.getByRole("button", { name: "Loop selected cue" }).click();
	try {
		await page
			.getByRole("button", { name: "Pause preview" })
			.waitFor({ timeout: 2_000 });
	} catch {
		throw new Error(
			`Cue loop did not enter playback: ${JSON.stringify({
				buttonLabels: await page.locator("button").evaluateAll((buttons) =>
					buttons.map((button) => ({
						ariaLabel: button.getAttribute("aria-label"),
						text: button.textContent?.trim(),
					})),
				),
				pageErrors,
			})}`,
		);
	}
	await page.waitForTimeout(
		Math.ceil(((cueRangeEnd - cueRangeStart) / 120_000) * 1_000) + 350,
	);
	const loopedPlayhead = await readPlayheadTicks();
	assert.ok(
		loopedPlayhead >= cueRangeStart && loopedPlayhead < cueRangeEnd,
		`Cue loop escaped its range: ${JSON.stringify({ cueRangeStart, cueRangeEnd, loopedPlayhead })}`,
	);
	await page.getByRole("button", { name: "Stop cue loop" }).click();
	await page.getByRole("button", { name: "Pause preview" }).click();
	await page.getByRole("button", { name: "Use cue as export range" }).click();
	try {
		await page
			.getByRole("button", { name: "Clear export range" })
			.waitFor({ timeout: 2_000 });
	} catch {
		throw new Error(
			`Cue export range did not update: ${JSON.stringify({
				buttonLabels: await page.locator("button").evaluateAll((buttons) =>
					buttons.map((button) => ({
						ariaLabel: button.getAttribute("aria-label"),
						text: button.textContent?.trim(),
					})),
				),
				pageErrors,
			})}`,
		);
	}
	await page.reload({ waitUntil: "domcontentloaded" });
	await page.waitForFunction(
		(name) =>
			[...document.querySelectorAll("span.truncate.text-xs.text-white")].filter(
				(element) => element.textContent?.trim().startsWith(name),
			).length === 2,
		MOTION_TEXT_CLIP_NAME,
	);
	await selectVisibleCueRange({
		clipIndex: selectedCueRange.clipIndex,
		cueIndex: selectedCueRange.cueIndex,
	});
	const reloadedCueRangeControls = page.locator(
		'[data-motion-text-cue-range="true"]',
	);
	await reloadedCueRangeControls.waitFor();
	assert.equal(
		Number(await reloadedCueRangeControls.getAttribute("data-range-start")),
		cueRangeStart,
	);
	assert.equal(
		Number(await reloadedCueRangeControls.getAttribute("data-range-end")),
		cueRangeEnd,
	);
	await page.getByRole("button", { name: "Use cue as export range" }).click();
	await page.getByRole("button", { name: "Clear export range" }).waitFor();
	await page.getByRole("button", { name: "Settings" }).click();
	const aspectRatioHeading = page.getByText("Aspect ratio", { exact: true });
	await aspectRatioHeading.waitFor();
	if (!(await page.getByRole("button", { name: /Custom/iu }).isVisible())) {
		await aspectRatioHeading.click();
	}
	await page.getByRole("button", { name: /Custom/iu }).click();
	await page.getByLabel("Canvas width").fill("640");
	await page.getByLabel("Canvas width").press("Tab");
	await page.getByLabel("Canvas height").fill("360");
	await page.getByLabel("Canvas height").press("Tab");
	await page.waitForTimeout(300);
	const rangeSampleOffsetTicks = Math.min(
		36_000,
		Math.floor((cueRangeEnd - cueRangeStart) / 2),
	);
	await setPlayheadTicks(cueRangeStart + rangeSampleOffsetTicks);
	await page.waitForTimeout(1_000);
	const previewCanvas = page.locator("canvas:visible").first();
	await previewCanvas.waitFor();
	const previewFrameBounds = await previewCanvas.boundingBox();
	if (!previewFrameBounds) throw new Error("The preview canvas is not visible");
	const previewFrameSize = {
		width: Math.round(previewFrameBounds.width),
		height: Math.round(previewFrameBounds.height),
	};
	const previewFramePng = await previewCanvas.screenshot({ type: "png" });
	await page.evaluate(() => {
		const blobs = new Map();
		const downloads = [];
		const createObjectUrl = URL.createObjectURL;
		const click = HTMLAnchorElement.prototype.click;
		URL.createObjectURL = function createTrackedObjectUrl(value) {
			const url = createObjectUrl.call(URL, value);
			if (value instanceof Blob) blobs.set(url, value);
			return url;
		};
		HTMLAnchorElement.prototype.click = function clickTrackedAnchor() {
			const blob = blobs.get(this.href);
			if (this.download && blob) {
				downloads.push({ blob, filename: this.download });
			}
			return click.call(this);
		};
		window.__motionTextExportProbe = { downloads };
	});

	await page.getByRole("button", { name: "Export", exact: true }).click();
	const exportHeading = page.getByRole("heading", { name: "Export project" });
	await exportHeading.waitFor();
	const exportPopover = exportHeading.locator("xpath=../..");
	await exportPopover.getByText("Range", { exact: true }).waitFor();
	await exportPopover
		.getByText(
			`${(cueRangeStart / 120_000).toFixed(2)}s – ${(cueRangeEnd / 120_000).toFixed(2)}s`,
			{ exact: true },
		)
		.waitFor();
	await page.getByText("Quality", { exact: true }).click();
	await page.getByText("Low - Smallest file size", { exact: true }).click();
	await page.getByText("Audio", { exact: true }).click();
	const includeAudio = page.getByRole("checkbox", {
		name: "Include audio in export",
	});
	assert.equal(await includeAudio.isChecked(), true);
	const exportOutcome = Promise.race([
		page
			.waitForEvent("download", { timeout: 0 })
			.then((download) => ({ kind: "download", download })),
		page
			.getByText("Export failed", { exact: true })
			.waitFor({ timeout: 0 })
			.then(async () => ({
				kind: "error",
				message:
					(await page
						.getByText("Export failed", { exact: true })
						.locator("xpath=parent::div")
						.innerText()) ?? "Export failed",
			})),
		page
			.waitForFunction(
				() => window.__motionTextExportProbe?.downloads.length > 0,
				undefined,
				{ timeout: 0 },
			)
			.then(() => ({ kind: "anchor" })),
		page.waitForTimeout(300_000).then(async () => ({
			kind: "timeout",
			heading: await page
				.getByRole("heading", { name: /Export/iu })
				.allTextContents(),
			progress: await page
				.locator("p")
				.filter({ hasText: /%/u })
				.allTextContents(),
		})),
	]);
	await exportPopover
		.getByRole("button", { name: "Export", exact: true })
		.click();
	await page
		.getByRole("heading", { name: "Exporting project" })
		.waitFor({ timeout: 10_000 });
	const exported = await exportOutcome;
	if (exported.kind === "error") throw new Error(exported.message);
	if (exported.kind === "timeout") {
		throw new Error(
			`Export did not settle: ${JSON.stringify({ heading: exported.heading, progress: exported.progress, pageErrors })}`,
		);
	}
	const exportBlob = await page.evaluate(async () => {
		const entry = window.__motionTextExportProbe?.downloads.at(-1);
		if (!entry) throw new Error("The export download anchor was not invoked");
		const bytes = new Uint8Array(await entry.blob.arrayBuffer());
		return {
			filename: entry.filename,
			size: entry.blob.size,
			type: entry.blob.type,
			boxType: String.fromCharCode(...bytes.slice(4, 8)),
		};
	});
	assert.match(exportBlob.filename, /\.mp4$/iu);
	assert.equal(exportBlob.type, "video/mp4");
	assert.equal(exportBlob.boxType, "ftyp");
	assert.ok(exportBlob.size > 0, "The exported MP4 blob is empty");

	let downloaded = exported.kind === "download" ? exported.download : null;
	if (!downloaded) {
		const replayedDownload = page.waitForEvent("download", { timeout: 10_000 });
		await page.evaluate(() => {
			const entry = window.__motionTextExportProbe?.downloads.at(-1);
			if (!entry)
				throw new Error("The export blob is unavailable for download");
			const url = URL.createObjectURL(entry.blob);
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = entry.filename;
			document.body.appendChild(anchor);
			anchor.click();
			anchor.remove();
			window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
		});
		downloaded = await replayedDownload;
	}
	assert.equal(await downloaded.failure(), null);
	assert.equal(downloaded.suggestedFilename(), exportBlob.filename);
	const exportPath = await downloaded.path();
	if (!exportPath)
		throw new Error("The browser did not retain the export file");
	const exportBytes = (await stat(exportPath)).size;
	assert.equal(exportBytes, exportBlob.size);
	const ffprobe = process.env.FFPROBE_PATH ?? "ffprobe";
	const audioStreams = execFileSync(
		ffprobe,
		[
			"-v",
			"error",
			"-select_streams",
			"a",
			"-show_entries",
			"stream=index",
			"-of",
			"csv=p=0",
			exportPath,
		],
		{ encoding: "utf8" },
	)
		.trim()
		.split(/\r?\n/u)
		.filter(Boolean);
	assert.equal(
		audioStreams.length,
		1,
		"The exported MP4 must have one audio stream",
	);
	const exportDurationSeconds = Number(
		execFileSync(
			ffprobe,
			[
				"-v",
				"error",
				"-show_entries",
				"format=duration",
				"-of",
				"default=noprint_wrappers=1:nokey=1",
				exportPath,
			],
			{ encoding: "utf8" },
		).trim(),
	);
	const expectedRangeDurationSeconds = (cueRangeEnd - cueRangeStart) / 120_000;
	assert.ok(
		Math.abs(exportDurationSeconds - expectedRangeDurationSeconds) <= 0.1,
		`Range export duration drifted: ${JSON.stringify({ exportDurationSeconds, expectedRangeDurationSeconds })}`,
	);
	const ffmpeg = process.env.FFMPEG_PATH ?? "ffmpeg";
	const scaleFilter = `scale=${previewFrameSize.width}:${previewFrameSize.height}`;
	const previewPixels = execFileSync(
		ffmpeg,
		[
			"-hide_banner",
			"-loglevel",
			"error",
			"-i",
			"pipe:0",
			"-frames:v",
			"1",
			"-vf",
			scaleFilter,
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgb24",
			"pipe:1",
		],
		{ input: previewFramePng, maxBuffer: 16 * 1024 * 1024 },
	);
	const exportedPixels = execFileSync(
		ffmpeg,
		[
			"-hide_banner",
			"-loglevel",
			"error",
			"-ss",
			String(rangeSampleOffsetTicks / 120_000),
			"-i",
			exportPath,
			"-frames:v",
			"1",
			"-vf",
			scaleFilter,
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgb24",
			"pipe:1",
		],
		{ maxBuffer: 16 * 1024 * 1024 },
	);
	assert.equal(exportedPixels.length, previewPixels.length);
	let absolutePixelDelta = 0;
	for (let index = 0; index < previewPixels.length; index += 1) {
		absolutePixelDelta += Math.abs(
			previewPixels[index] - exportedPixels[index],
		);
	}
	const previewExportMeanAbsoluteError =
		absolutePixelDelta / previewPixels.length;
	assert.ok(
		previewExportMeanAbsoluteError <= 20,
		`Preview/export frame delta is too large: ${previewExportMeanAbsoluteError}`,
	);

	await page.goto(
		`${new URL(editorUrl).origin}/script/fixtures/motion-text-browser-probe.html`,
		{ waitUntil: "domcontentloaded" },
	);
	await page.evaluate(async (id) => {
		const { BrowserProjectStore } =
			await import("/@id/@opencut/editor-classic/storage");
		const store = new BrowserProjectStore();
		const record = await store.load({ id });
		if (!record) throw new Error("The UI probe project disappeared");
		const data = record.data;
		const sequences = data.motionTextSequences;
		if (!Array.isArray(sequences) || sequences.length !== 1) {
			throw new Error("The UI probe project has no motion-text sequence");
		}
		const sequence = sequences[0];
		if (typeof sequence !== "object" || sequence === null) {
			throw new Error("The UI probe motion-text sequence is invalid");
		}
		if (
			sequence.revision !== 8 ||
			typeof sequence.resolvedPlan !== "object" ||
			sequence.resolvedPlan === null ||
			sequence.resolvedPlan.sequenceRevision !== 8
		) {
			throw new Error("The synchronized sequence did not persist after reload");
		}
		const audioBinding = sequence.audioBinding;
		if (
			typeof audioBinding !== "object" ||
			audioBinding === null ||
			typeof audioBinding.contentDigest !== "string" ||
			typeof audioBinding.sourceOffset !== "number" ||
			audioBinding.sourceOffset <= 0 ||
			typeof audioBinding.analysis?.bpm !== "number" ||
			Math.abs(audioBinding.analysis.bpm - 120) >= 1 ||
			audioBinding.beatOverride?.bpm !== 128 ||
			audioBinding.beatOverride?.firstBeat !== 30_000
		) {
			throw new Error(
				`The analyzed audio binding did not persist after reload: ${JSON.stringify(audioBinding)}`,
			);
		}
		const cues = sequence.cues;
		if (!Array.isArray(cues) || cues.length !== 12) {
			throw new Error("The F01 motion-text sequence does not have 12 cues");
		}
		if (
			cues[4]?.startTime !== 592_500 ||
			cues[4]?.duration !== 112_500 ||
			cues[4]?.timingSource !== "manual"
		) {
			throw new Error("Beat-snapped direct cue timing did not persist");
		}
		if (
			!Array.isArray(cues[1]?.cutDurations) ||
			cues[1].cutDurations.join(",") !== "51477,46705,49091"
		) {
			throw new Error("Beat-snapped cut boundary partition did not persist");
		}
		if (cues[10]?.timingSource !== "tap" || cues[11]?.timingSource !== "tap") {
			throw new Error("Tapped cue timing provenance did not persist");
		}
		if (
			!cues.some(
				(candidate) =>
					typeof candidate === "object" &&
					candidate !== null &&
					candidate.interlude === true,
			)
		) {
			throw new Error("The F01 motion-text sequence lost its interlude");
		}
		if (
			!cues.some(
				(candidate) =>
					typeof candidate === "object" &&
					candidate !== null &&
					Array.isArray(candidate.segments) &&
					candidate.segments.length === 3,
			)
		) {
			throw new Error("The F01 motion-text sequence lost its manual segments");
		}
		const cue = cues[0];
		if (typeof cue !== "object" || cue === null) {
			throw new Error("The UI probe motion-text cue is invalid");
		}
		if (
			cue.impact !== true ||
			!Array.isArray(cue.emphasis) ||
			!cue.emphasis.includes("第一句")
		) {
			throw new Error("The F01 motion-text sequence lost emphasis metadata");
		}
		const scenes = data.scenes;
		if (!Array.isArray(scenes)) {
			throw new Error("The F01 project has no scenes");
		}
		const currentScene = scenes.find(
			(scene) =>
				typeof scene === "object" &&
				scene !== null &&
				scene.id === data.currentSceneId,
		);
		if (!currentScene || typeof currentScene.tracks !== "object") {
			throw new Error("The F01 current scene is invalid");
		}
		const mainElements = currentScene.tracks.main?.elements;
		if (
			!Array.isArray(mainElements) ||
			mainElements.filter(
				(element) =>
					typeof element === "object" &&
					element !== null &&
					element.type === "video",
			).length < 3
		) {
			throw new Error("The F01 project lost its three lower video clips");
		}
		const overlayTracks = currentScene.tracks.overlay;
		const audioTracks = currentScene.tracks.audio;
		const audioElements = Array.isArray(audioTracks)
			? audioTracks.flatMap((track) =>
					typeof track === "object" &&
					track !== null &&
					Array.isArray(track.elements)
						? track.elements
						: [],
				)
			: [];
		if (audioElements.length !== 1) {
			throw new Error(
				"Motion-text analysis created or removed a timeline audio clip",
			);
		}
		const motionTextElements = Array.isArray(overlayTracks)
			? overlayTracks.flatMap((track) =>
					typeof track === "object" &&
					track !== null &&
					Array.isArray(track.elements)
						? track.elements.filter(
								(element) =>
									typeof element === "object" &&
									element !== null &&
									element.type === "motion-text",
							)
						: [],
				)
			: [];
		if (motionTextElements.length !== 2) {
			throw new Error("The F01 project lost its split motion-text clips");
		}
	}, projectId);

	await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
	await timelineTitle.first().waitFor({ timeout: 15_000 });
	await timelineTitle.first().locator("xpath=ancestor::button[1]").click();
	await cueRows().first().click();
	const lockSection = () =>
		page
			.getByRole("heading", { name: "Locks & inheritance" })
			.locator("xpath=ancestor::section[1]");
	const layoutLock = () =>
		lockSection().getByRole("button", { name: "Layout", exact: true });
	const firstCueLayouts = async () =>
		page.evaluate(async (id) => {
			const { BrowserProjectStore } =
				await import("/@id/@opencut/editor-classic/storage");
			const record = await new BrowserProjectStore().load({ id });
			const sequence = record?.data.motionTextSequences?.[0];
			const cue = sequence?.cues?.[0];
			if (!sequence?.resolvedPlan || !cue) {
				throw new Error("The lock probe sequence is missing");
			}
			return sequence.resolvedPlan.cuts
				.filter((cut) => cut.cueId === cue.id)
				.map((cut) => cut.preset.layout);
		}, projectId);

	await layoutLock().click();
	await page.getByText("r9", { exact: true }).waitFor();
	assert.equal(await layoutLock().getAttribute("aria-pressed"), "true");
	await expectEnabled(page.getByLabel("Lyric text"));
	await expectDisabled(cueEditor().getByRole("combobox").first());
	await expectEnabled(page.getByLabel("Start (sec)"));
	await timelineTitle.first().locator("xpath=ancestor::button[1]").click();
	await page.keyboard.press("Control+z");
	await page.getByText("r8", { exact: true }).waitFor();
	assert.equal(await layoutLock().getAttribute("aria-pressed"), "false");
	await expectEnabled(cueEditor().getByRole("combobox").first());
	await timelineTitle.first().locator("xpath=ancestor::button[1]").click();
	await page.keyboard.press("Control+Shift+z");
	await page.getByText("r9", { exact: true }).waitFor();
	assert.equal(await layoutLock().getAttribute("aria-pressed"), "true");

	await page.getByRole("button", { name: "Edit font and colors" }).click();
	const lockedDefaultsEditor = page
		.getByText("Default font", { exact: true })
		.locator(
			"xpath=ancestor::div[.//button[normalize-space()='Apply changes']][1]",
		);
	await expectEnabled(
		lockedDefaultsEditor.getByRole("button", { name: "Customize" }),
	);
	await lockedDefaultsEditor.getByRole("button", { name: "Cancel" }).click();

	const layoutsBeforeVariation = await firstCueLayouts();
	const finalVariationSection = page
		.getByRole("heading", { name: "Variation" })
		.last()
		.locator("xpath=ancestor::section[1]");
	await finalVariationSection
		.getByRole("button", { name: "Generate variation" })
		.click();
	await finalVariationSection
		.getByRole("button", { name: "Apply variation" })
		.click();
	await page.getByText("r10", { exact: true }).waitFor();
	assert.deepEqual(await firstCueLayouts(), layoutsBeforeVariation);
	assert.equal(await layoutLock().getAttribute("aria-pressed"), "true");

	await page.reload({ waitUntil: "domcontentloaded" });
	await timelineTitle.first().waitFor({ timeout: 15_000 });
	await timelineTitle.first().locator("xpath=ancestor::button[1]").click();
	await page.getByText("r10", { exact: true }).waitFor();
	await cueRows().first().click();
	assert.equal(await layoutLock().getAttribute("aria-pressed"), "true");

	await lockSection().getByRole("button", { name: "Lock cue" }).click();
	await page.getByText("r11", { exact: true }).waitFor();
	await expectDisabled(page.getByLabel("Lyric text"));
	await expectDisabled(page.getByLabel("Start (sec)"));
	await timelineTitle.first().locator("xpath=ancestor::button[1]").click();
	await page.keyboard.press("Control+z");
	await page.getByText("r10", { exact: true }).waitFor();
	await expectEnabled(page.getByLabel("Lyric text"));

	const firstCutLock = lockSection()
		.getByText("Resolved cuts", { exact: true })
		.locator("xpath=following-sibling::div[1]//button")
		.first();
	await firstCutLock.click();
	await page.getByText("r11", { exact: true }).waitFor();
	await expectDisabled(page.getByLabel("Lyric text"));
	await expectEnabled(page.getByLabel("Start (sec)"));
	await timelineTitle.first().locator("xpath=ancestor::button[1]").click();
	await page.keyboard.press("Control+z");
	await page.getByText("r10", { exact: true }).waitFor();
	await expectEnabled(page.getByLabel("Lyric text"));

	const starterParameterLock = lockSection().getByRole("button", {
		name: "rocut.starterPreset",
		exact: true,
	});
	await starterParameterLock.click();
	await page.getByText("r11", { exact: true }).waitFor();
	await expectEnabled(page.getByLabel("Lyric text"));
	assert.equal(await starterParameterLock.getAttribute("aria-pressed"), "true");
	await timelineTitle.first().locator("xpath=ancestor::button[1]").click();
	await page.keyboard.press("Control+z");
	await page.getByText("r10", { exact: true }).waitFor();
	assert.equal(
		await starterParameterLock.getAttribute("aria-pressed"),
		"false",
	);
	assert.deepEqual(pageErrors, []);

	console.log(
		JSON.stringify(
			{
				checks: {
					audioAnalysisBindingPersisted: true,
					audioBeatOverrideUndoRedo: true,
					audioExportStreamIsUnique: true,
					audioResyncCancelRestored: true,
					audioResyncPreview: true,
					audioResyncUndoRedo: true,
					cueLoopPlayback: true,
					cueRangeExport: true,
					cutBoundaryBeatSnapUndoRedo: true,
					directCueBeatSnap: true,
					manualCueTapContinueUndoAndSnap: true,
					cancelIsLocal: true,
					wasmEntry: WASM_ENTRY,
					installedWasmUiBoot: USE_INSTALLED_WASM,
					cueEditPersistedAfterReload: true,
					defaultsDirtyState: true,
					focusAndScroll: true,
					formalF01Fixture: true,
					fractionalCueTimePreserved: true,
					imeCompositionGuard: true,
					advancedLockTransactionsAndPersistence: true,
					manualAndTappedTimingPreserved: true,
					overlapFailsClosed: true,
					staleCandidateDiscarded: true,
					starterCancelIsLocal: true,
					starterCanvasPreviewIsReal: true,
					timelineMoveTrimSplitUndoRedo: true,
					timelineSplitPersistedAfterReload: true,
					variationApplyIsSingleUndo: true,
					variationCanvasPreviewAndCancel: true,
					variationPersistedAfterReload: true,
					previewExportFrameCompared: true,
					videoOverlayPersisted: true,
					viewportContained: true,
				},
				viewport: layout,
				exportBytes,
				exportDurationSeconds,
				expectedRangeDurationSeconds,
				previewExportMeanAbsoluteError,
			},
			null,
			2,
		),
	);
} finally {
	await browser?.close();
	await server.close();
}

async function expectDisabled(locator) {
	assert.equal(await locator.isDisabled(), true);
}

async function expectEnabled(locator) {
	assert.equal(await locator.isEnabled(), true);
}

function buildClickTrackWav({ durationSeconds, sampleRate }) {
	const sampleCount = durationSeconds * sampleRate;
	const bytesPerSample = 2;
	const dataBytes = sampleCount * bytesPerSample;
	const buffer = Buffer.alloc(44 + dataBytes);
	buffer.write("RIFF", 0, "ascii");
	buffer.writeUInt32LE(36 + dataBytes, 4);
	buffer.write("WAVE", 8, "ascii");
	buffer.write("fmt ", 12, "ascii");
	buffer.writeUInt32LE(16, 16);
	buffer.writeUInt16LE(1, 20);
	buffer.writeUInt16LE(1, 22);
	buffer.writeUInt32LE(sampleRate, 24);
	buffer.writeUInt32LE(sampleRate * bytesPerSample, 28);
	buffer.writeUInt16LE(bytesPerSample, 32);
	buffer.writeUInt16LE(16, 34);
	buffer.write("data", 36, "ascii");
	buffer.writeUInt32LE(dataBytes, 40);
	const firstBeat = Math.floor(sampleRate / 5);
	const period = Math.floor(sampleRate / 2);
	for (let beat = firstBeat; beat < sampleCount; beat += period) {
		for (let offset = 0; offset < 32 && beat + offset < sampleCount; offset++) {
			const amplitude = Math.round(30_000 * (1 - offset / 32));
			buffer.writeInt16LE(amplitude, 44 + (beat + offset) * bytesPerSample);
		}
	}
	return buffer;
}
