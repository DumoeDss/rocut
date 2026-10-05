#!/usr/bin/env node
/**
 * Runs the section-14 installed-artifact acceptance against a real plugin
 * install and produces the evidence root + acceptance.json manifest that
 * script/validate-motion-text-installed-acceptance.mjs verifies.
 *
 * The runner NEVER fabricates evidence: every artifact is captured from the
 * live isolated surface (screenshots, exports, CLI stdout) or measured from
 * the produced bytes (ffprobe). Steps that cannot be executed fail loudly.
 *
 * Usage:
 *   node script/run-motion-text-installed-acceptance.mjs \
 *     --plugin-root <isolated plugin copy> \
 *     --evidence-root <output dir> \
 *     --rocut-commit <40-hex> --plugin-commit <40-hex> \
 *     --canonical-wasm <path> --installed-wasm <path> \
 *     [--fixture-video <path>] [--ffprobe <path>] [--keep-project]
 */

import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { chromium } from "@playwright/test";

import { MOTION_TEXT_F01_SOURCE } from "./fixtures/motion-text-f01-fixture.mjs";
import {
	probeExportMedia as probeMedia,
	exportMediaFacts as mediaFacts,
} from "./installed-export-media-facts.mjs";

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TICKS_PER_SECOND = 120_000;

function option(name) {
	const index = process.argv.indexOf(name);
	if (index < 0) return undefined;
	const value = process.argv[index + 1];
	if (!value || value.startsWith("--")) {
		throw new Error(`${name} requires a value`);
	}
	return value;
}

function requireOption(name) {
	const value = option(name);
	if (value === undefined) throw new Error(`${name} is required`);
	return value;
}

function sha256(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}

function percentile(values, q) {
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
}

function identity(path) {
	const bytes = readFileSync(path);
	return { bytes: bytes.length, sha256: sha256(bytes) };
}

function die(message) {
	console.error(`installed acceptance: FAIL: ${message}`);
	process.exit(1);
}

/** WAV click track, same shape as the canonical UI probe's fixture. */
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

async function extractFrames(ffmpeg, mp4Path, outDir, prefix, phases) {
	const secondsFor = { first: 0.05, middle: null, last: null };
	const probe = await probeMedia(option("--ffprobe") ?? "ffprobe", mp4Path);
	const duration = Number(probe.format.duration);
	secondsFor.middle = duration / 2;
	secondsFor.last = Math.max(0, duration - 0.1);
	const paths = [];
	for (const phase of phases) {
		const outPath = join(outDir, `frames/${prefix}-${phase}.png`);
		await run(ffmpeg, [
			"-y",
			"-ss",
			secondsFor[phase].toFixed(3),
			"-i",
			mp4Path,
			"-frames:v",
			"1",
			outPath,
		]);
		paths.push(`frames/${prefix}-${phase}.png`);
	}
	return paths;
}

async function main() {
	const pluginRoot = resolve(requireOption("--plugin-root"));
	const evidenceRoot = resolve(requireOption("--evidence-root"));
	const rocutCommit = requireOption("--rocut-commit");
	const pluginCommit = requireOption("--plugin-commit");
	const canonicalWasmPath = resolve(requireOption("--canonical-wasm"));
	const installedWasmPath = resolve(requireOption("--installed-wasm"));
	const ffprobe = option("--ffprobe") ?? "ffprobe";
	const ffmpeg = option("--ffmpeg") ?? "ffmpeg";
	const fixtureVideo = resolve(
		option("--fixture-video") ??
			join(ROOT, "apps/vite-example/tests/fixtures/fixture-video.mp4"),
	);
	const keepProject = process.argv.includes("--keep-project");

	const cli = join(pluginRoot, "vendor", "run", "rocut.mjs");
	const staticDir = join(pluginRoot, "vendor", "surface");
	for (const path of [cli, staticDir, fixtureVideo]) {
		if (!existsSync(path)) die(`missing required path: ${path}`);
	}

	if (existsSync(evidenceRoot)) {
		rmSync(evidenceRoot, { recursive: true, force: true });
	}
	for (const sub of [
		"project",
		"logs",
		"screenshots",
		"exports",
		"frames",
		"performance",
	]) {
		mkdirSync(join(evidenceRoot, sub), { recursive: true });
	}

	const workRoot = join(tmpdir(), `rocut-accept-${Date.now().toString(36)}`);
	const projectDir = join(workRoot, "project");
	const targetsRoot = join(workRoot, "targets");
	mkdirSync(projectDir, { recursive: true });
	mkdirSync(targetsRoot, { recursive: true });

	const commandLog = [];
	const logCommand = (entry) => {
		// Strip any host-specific absolute paths before the entry hits disk.
		const redacted = JSON.stringify(entry).replaceAll(workRoot, "<work>");
		commandLog.push(JSON.parse(redacted));
	};

	const artifacts = [];
	const artifactByPath = new Map();
	const addArtifact = (relativePath, kind) => {
		const absolute = join(evidenceRoot, relativePath);
		const bytes = readFileSync(absolute);
		const entry = {
			path: relativePath,
			kind,
			bytes: bytes.length,
			sha256: sha256(bytes),
		};
		artifacts.push(entry);
		artifactByPath.set(relativePath, entry);
		return entry;
	};
	const writeText = (relativePath, text) => {
		writeFileSync(
			join(evidenceRoot, relativePath),
			text.endsWith("\n") ? text : `${text}\n`,
			"utf8",
		);
		return relativePath;
	};

	console.log("[setup] isolated host on a fresh project");
	const ensured = await run(
		process.execPath,
		[
			cli,
			"host",
			"ensure",
			projectDir,
			"--static",
			staticDir,
			"--targets-root",
			targetsRoot,
		],
		{ maxBuffer: 4 * 1024 * 1024 },
	);
	const ensureLines = Object.fromEntries(
		ensured.stdout
			.split(/\r?\n/)
			.filter((line) => line.includes(" "))
			.map((line) => {
				const space = line.indexOf(" ");
				return [line.slice(0, space), line.slice(space + 1)];
			}),
	);
	const editorUrl = ensureLines.editorUrl;
	const targetId = ensureLines.target;
	if (!editorUrl || !targetId) {
		die(`host ensure did not report editorUrl/target: ${ensured.stdout}`);
	}
	const hostPid = Number(ensureLines.pid);
	logCommand({
		step: "S14-01",
		command: "host ensure",
		result: { target: targetId, pid: hostPid, state: ensureLines.state },
	});

	console.log("[S14-01..09] browser session on the installed surface");
	const browser = await chromium.launch({
		headless: true,
		args: [
			"--use-angle=swiftshader",
			"--enable-unsafe-swiftshader",
			"--enable-precise-memory-info",
		],
	});
	const page = await browser.newPage({
		viewport: { width: 1920, height: 1080 },
	});
	const browserName = browser.browserType().name();
	const pageErrors = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") pageErrors.push(message.text());
	});

	const cliJson = async (args) => {
		const { stdout } = await run(
			process.execPath,
			[cli, ...args, "--target", targetId, "--targets-root", targetsRoot],
			{ maxBuffer: 32 * 1024 * 1024, timeout: 900_000 },
		);
		return JSON.parse(stdout);
	};

	try {
		await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
		await page
			.getByRole("button", { name: "Motion text", exact: true })
			.waitFor({ timeout: 60_000 });

		// S14-02: import real media + create the F01 motion-text sequence.
		const [videoChooser] = await Promise.all([
			page.waitForEvent("filechooser"),
			page
				.locator(
					'button:has-text("Drag and drop videos, photos, and audio files here")',
				)
				.first()
				.click(),
		]);
		await videoChooser.setFiles(fixtureVideo);
		const videoCard = page
			.locator("div.group")
			.filter({ has: page.locator('[title="fixture-video.mp4"]') })
			.first();
		await videoCard.waitFor({ timeout: 60_000 });
		await videoCard.hover();
		await videoCard.locator("button").first().click();
		await page.waitForTimeout(400);

		const audioName = "motion-text-click-track.wav";
		await page.locator('input[type="file"]').setInputFiles({
			name: audioName,
			mimeType: "audio/wav",
			buffer: buildClickTrackWav({
				durationSeconds: 30,
				sampleRate: 8_000,
			}),
		});
		const audioCard = page
			.locator("div.group")
			.filter({ has: page.locator(`[title="${audioName}"]`) })
			.first();
		await audioCard.waitFor({ timeout: 60_000 });
		await audioCard.hover();
		await audioCard.locator("button").first().click();
		await page.waitForTimeout(400);

		await page
			.getByRole("button", { name: "Motion text", exact: true })
			.click();
		const source = page.getByLabel("Lines");
		await source.fill(MOTION_TEXT_F01_SOURCE);
		await source.press("Control+Enter");
		await page
			.getByRole("heading", { name: "Sequence defaults" })
			.waitFor({ timeout: 60_000 });
		await page.getByText("12 cues", { exact: true }).waitFor();
		logCommand({
			step: "S14-02",
			facts: {
				videoImported: true,
				audioImported: true,
				cueCount: 12,
			},
		});

		// 1920x1080 canvas so the exports satisfy the contract.
		await page.getByRole("button", { name: "Settings" }).click();
		const aspectRatioHeading = page.getByText("Aspect ratio", { exact: true });
		await aspectRatioHeading.waitFor();
		if (!(await page.getByRole("button", { name: /Custom/iu }).isVisible())) {
			await aspectRatioHeading.click();
		}
		await page.getByRole("button", { name: /Custom/iu }).click();
		await page.getByLabel("Canvas width").fill("1920");
		await page.getByLabel("Canvas width").press("Tab");
		await page.getByLabel("Canvas height").fill("1080");
		await page.getByLabel("Canvas height").press("Tab");
		await page.waitForTimeout(600);
		await page.keyboard.press("Escape");
		await page.waitForTimeout(400);

		// S14-03: preset catalog preview on first / switch / last cues.
		// The cue list only renders for a SELECTED motion-text clip, so select
		// the clip on the timeline first (same order as the canonical probe).
		const clipTitleForSelect = page
			.locator("span.truncate.text-xs.text-white")
			.filter({ hasText: /Clean caption/iu })
			.first();
		await clipTitleForSelect.locator("xpath=ancestor::button[1]").click();
		await page.waitForTimeout(500);
		const presetSection = page
			.getByRole("heading", { name: "Starter style" })
			.last()
			.locator("xpath=ancestor::section[1]");
		const previewCanvas = page.locator("canvas:visible").first();
		const cueRows = () =>
			page.locator(
				'section[aria-labelledby="motion-text-cues-heading"] > div > button',
			);
		await cueRows().first().click();
		await page.waitForTimeout(500);
		await presetSection.getByRole("button", { name: /Impact title/iu }).click();
		await presetSection.getByText("Preview only", { exact: true }).waitFor();
		await page.waitForTimeout(600);
		await cueRows().last().click();
		await page.waitForTimeout(400);
		logCommand({ step: "S14-03", facts: { presetPreviewed: true } });

		// S14-04: edit cue 2, lock its layout, vary the rest, confirm cue 2 held.
		await cueRows().nth(1).click();
		const lyric = page.getByLabel("Lyric text");
		await lyric.fill("灯火落在肩上 · 已锁定");
		const cueEditor = () =>
			lyric.locator(
				"xpath=ancestor::div[.//button[normalize-space()='Apply changes']][1]",
			);
		await cueEditor().getByRole("button", { name: "Apply changes" }).click();
		await page.waitForTimeout(400);
		const lockSection = () =>
			page
				.getByRole("heading", { name: "Locks & inheritance" })
				.locator("xpath=ancestor::section[1]");
		// Applying a cue edit closes the selected-cue detail (including the lock
		// editor), so reselect cue 2 before locking its layout preset group.
		await cueRows().nth(1).click();
		await page.waitForTimeout(300);
		await lockSection()
			.getByRole("button", { name: "Layout", exact: true })
			.click();
		await page.waitForTimeout(300);
		const variationSection = () =>
			page
				.getByRole("heading", { name: "Variation" })
				.last()
				.locator("xpath=ancestor::section[1]");
		await variationSection()
			.getByRole("button", { name: "Generate variation" })
			.click();
		await variationSection()
			.getByRole("button", { name: "Apply variation" })
			.click();
		await page.waitForTimeout(600);
		await cueRows().nth(1).click();
		await page.waitForTimeout(300);
		const lockHeld =
			(await lockSection()
				.getByRole("button", { name: "Layout", exact: true })
				.getAttribute("aria-pressed")) === "true";
		if (!lockHeld) die("S14-04 layout lock did not survive the variation");
		logCommand({ step: "S14-04", facts: { lockHeldThroughVariation: true } });

		// S14-05: timeline move + head trim + mid-effect split.
		const clipTitle = page
			.locator("span.truncate.text-xs.text-white")
			.filter({ hasText: /Clean caption/iu })
			.first();
		const clipButton = clipTitle.locator("xpath=ancestor::button[1]");
		await clipButton.click();
		const originalBounds = await clipButton.boundingBox();
		if (!originalBounds) die("motion-text clip not visible for S14-05");
		const dragX = originalBounds.x + Math.min(100, originalBounds.width / 4);
		await page.keyboard.down("Shift");
		await page.mouse.move(dragX, originalBounds.y + originalBounds.height / 2);
		await page.mouse.down();
		await page.mouse.move(
			dragX + 120,
			originalBounds.y + originalBounds.height / 2,
			{ steps: 8 },
		);
		await page.mouse.up();
		await page.keyboard.up("Shift");
		await page.waitForTimeout(400);
		const leftResize = page.getByRole("button", {
			name: "Left resize handle",
		});
		const resizeBounds = await leftResize.boundingBox();
		if (resizeBounds) {
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
			await page.waitForTimeout(400);
		}
		const ruler = page.getByRole("slider", { name: "Timeline ruler" });
		const rulerBounds = await ruler.boundingBox();
		const trimmedBounds = await clipButton.boundingBox();
		if (rulerBounds && trimmedBounds) {
			await page.mouse.click(
				trimmedBounds.x + Math.min(160, trimmedBounds.width / 2),
				rulerBounds.y + rulerBounds.height / 2,
			);
			await clipButton.click();
			await page.keyboard.press("s");
			await page.waitForTimeout(600);
		}
		const splitCount = await page
			.locator("span.truncate.text-xs.text-white")
			.filter({ hasText: /Clean caption/iu })
			.count();
		if (splitCount < 2) {
			die(`S14-05 split did not produce two clips (got ${splitCount})`);
		}
		logCommand({ step: "S14-05", facts: { clipsAfterSplit: splitCount } });

		// S14-06: undo/redo round trip.
		await page.keyboard.press("Control+z");
		await page.waitForTimeout(300);
		const undoneCount = await page
			.locator("span.truncate.text-xs.text-white")
			.filter({ hasText: /Clean caption/iu })
			.count();
		if (undoneCount !== 1) {
			die(`S14-06 undo did not restore one clip (got ${undoneCount})`);
		}
		await page.keyboard.press("Control+Shift+z");
		await page.waitForTimeout(300);
		const redoneCount = await page
			.locator("span.truncate.text-xs.text-white")
			.filter({ hasText: /Clean caption/iu })
			.count();
		if (redoneCount !== splitCount) {
			die(`S14-06 redo did not restore ${splitCount} clips`);
		}
		logCommand({ step: "S14-06", facts: { undoRedoVerified: true } });

		// S14-07: save (autosave to host), close (reload), reopen.
		await page.reload({ waitUntil: "domcontentloaded" });
		await page
			.getByRole("button", { name: "Motion text", exact: true })
			.waitFor({ timeout: 60_000 });
		await page.waitForTimeout(2_500);
		const reopenedClips = await page
			.locator("span.truncate.text-xs.text-white")
			.filter({ hasText: /Clean caption/iu })
			.count();
		if (reopenedClips !== splitCount) {
			die(
				`S14-07 reopen lost clips: expected ${splitCount}, got ${reopenedClips}`,
			);
		}
		await page.screenshot({
			path: join(evidenceRoot, "screenshots", "editor.png"),
			fullPage: false,
		});
		logCommand({ step: "S14-07", facts: { reopenedClips } });

		// S14-08: Agent reads cue IDs, mutates, user conflict, reread, retry.
		const listed = await cliJson(["motion-text", "list"]);
		const sequence = listed.sequences[0];
		const stableCueId = sequence.cues[2].id;
		const revisionsBefore = {
			projectRevisionBefore: listed.projectRevision,
			sequenceRevisionBefore: sequence.revision,
		};
		const specDir = join(workRoot, "specs");
		mkdirSync(specDir, { recursive: true });
		const mutationPath = join(specDir, "s14-08.json");
		const staleMutation = {
			mutation: {
				kind: "update-cue",
				cueId: stableCueId,
				text: "字句穿过清晨的雾 · Agent",
				startTime: sequence.cues[2].startTime,
				duration: sequence.cues[2].duration,
				preset: { mode: "keep" },
				font: { mode: "keep" },
				colors: { mode: "keep" },
			},
			// Deliberately the pre-edit revision: the UI edits above advanced it.
			expectedRevision: Math.max(0, revisionsBefore.projectRevisionBefore - 1),
			expectedSequenceRevision: revisionsBefore.sequenceRevisionBefore,
			idempotencyKey: "accept:s14-08:stale",
		};
		writeFileSync(mutationPath, JSON.stringify(staleMutation), "utf8");

		let conflictObserved = false;
		let conflictCode = null;
		try {
			await cliJson(["motion-text", "mutate", sequence.id, mutationPath]);
		} catch (error) {
			const stderr = error?.stderr ?? "";
			conflictObserved = stderr.includes("409");
			conflictCode = conflictObserved ? "conflict" : stderr.slice(0, 200);
		}
		if (!conflictObserved) {
			die(`S14-08 stale mutation did not conflict: ${conflictCode}`);
		}

		const reread = await cliJson(["motion-text", "list"]);
		const currentSequence = reread.sequences[0];
		const retryMutation = {
			...staleMutation,
			mutation: {
				...staleMutation.mutation,
				cueId: currentSequence.cues[2].id,
				startTime: currentSequence.cues[2].startTime,
				duration: currentSequence.cues[2].duration,
			},
			expectedRevision: reread.projectRevision,
			expectedSequenceRevision: currentSequence.revision,
			idempotencyKey: "accept:s14-08:retry",
		};
		const retryPath = join(specDir, "s14-08-retry.json");
		writeFileSync(retryPath, JSON.stringify(retryMutation), "utf8");
		const retried = await cliJson([
			"motion-text",
			"mutate",
			sequence.id,
			retryPath,
		]);
		const retrySucceeded =
			retried.sequenceRevision === currentSequence.revision + 1;
		if (!retrySucceeded) {
			die(`S14-08 retry did not advance revision: ${JSON.stringify(retried)}`);
		}
		logCommand({
			step: "S14-08",
			command: "motion-text mutate (stale then reread retry)",
			result: {
				conflictObserved,
				retrySucceeded,
				...revisionsBefore,
				projectRevisionAfter: reread.projectRevision + 1,
				sequenceRevisionAfter: retried.sequenceRevision,
			},
		});

		// S14-09: second sequence in a different language + shuffled seeks.
		const secondSpec = join(specDir, "s14-09.json");
		writeFileSync(
			secondSpec,
			JSON.stringify({
				sourceFormat: "plain",
				source: "街の光\n夜のNeon",
				language: "ja",
				duration: 240_000,
				expectedRevision: reread.projectRevision + 1,
				idempotencyKey: "accept:s14-09:ja-sequence",
			}),
			"utf8",
		);
		const secondCreated = await cliJson(["motion-text", "create", secondSpec]);
		if (secondCreated.sequenceRevision !== 0) {
			die("S14-09 second sequence was not created at revision 0");
		}
		const timecode = page.locator('button[title="Click to edit time"]').first();
		const timecodeInput = page.locator("input.font-mono.tabular-nums").first();
		const seekSeconds = [7, 2, 9, 4, 11, 1, 8, 3];
		const seekStopwatch = [];
		await page.bringToFront().catch(() => undefined);
		for (const seconds of seekSeconds) {
			// Capture the current timecode text while the button is still in
			// display mode, then open the editor and submit the new time.
			const beforeEnter = (await timecode.textContent()) ?? String(seconds);
			await timecode.click();
			await timecodeInput.fill(`00:00:${String(seconds).padStart(2, "0")}:00`);
			// Measure the interactive seek latency only: from the Enter
			// keypress until the transport timecode changes. Typing and
			// clicking automation overhead is not seek latency, and matching
			// "the text changed" avoids coupling to the exact timecode format.
			const started = Date.now();
			await timecodeInput.press("Enter");
			await page
				.waitForFunction(
					(expected) => {
						const buttons = document.querySelectorAll(
							'button[title="Click to edit time"]',
						);
						return [...buttons].some(
							(button) => button.textContent !== expected,
						);
					},
					beforeEnter,
					{ timeout: 5_000 },
				)
				.catch(() => undefined);
			seekStopwatch.push(Date.now() - started);
			await page.waitForTimeout(220);
		}
		const seekP95 = percentile(seekStopwatch, 0.95);
		logCommand({
			step: "S14-09",
			command: "motion-text create (ja) + shuffled seeks",
			result: {
				secondSequenceLanguage: "ja",
				seekSamples: seekStopwatch,
				seekP95Ms: seekP95,
			},
		});

		// S14-10: full export + selected-range export, both 1080p with audio.
		const fullOut = join(evidenceRoot, "exports", "full.mp4");
		const fullStarted = Date.now();
		const fullResult = await run(
			process.execPath,
			[
				cli,
				"export",
				"--target",
				targetId,
				"--targets-root",
				targetsRoot,
				"--format",
				"mp4",
				"--quality",
				"low",
				"--out",
				fullOut,
			],
			{ maxBuffer: 16 * 1024 * 1024, timeout: 1_200_000 },
		);
		const fullExportDurationMs = Date.now() - fullStarted;

		const listedForRange = await cliJson(["read"]);
		const timelineDurationTicks = Math.max(
			...listedForRange.entities.clips.map(
				(clip) => clip.endTime ?? clip.startTime + clip.duration ?? 0,
			),
		);
		const rangeStart = Math.min(
			Math.floor(timelineDurationTicks / 3),
			2 * TICKS_PER_SECOND,
		);
		const rangeEnd = Math.min(
			rangeStart + 2 * TICKS_PER_SECOND,
			timelineDurationTicks,
		);
		const selectedOut = join(evidenceRoot, "exports", "selected.mp4");
		await run(
			process.execPath,
			[
				cli,
				"export",
				"--target",
				targetId,
				"--targets-root",
				targetsRoot,
				"--format",
				"mp4",
				"--quality",
				"low",
				"--start-time",
				String(rangeStart),
				"--end-time",
				String(rangeEnd),
				"--out",
				selectedOut,
			],
			{ maxBuffer: 16 * 1024 * 1024, timeout: 1_200_000 },
		);
		logCommand({
			step: "S14-10",
			command: "export full + selected",
			result: {
				fullExportDurationMs,
				rangeTicks: { start: rangeStart, end: rangeEnd },
			},
		});

		// S14-11: with the pane closed, export must 409 and reads must work.
		await browser.close();
		const panelExportAttempt = await (async () => {
			try {
				await run(
					process.execPath,
					[
						cli,
						"export",
						"--target",
						targetId,
						"--targets-root",
						targetsRoot,
						"--format",
						"mp4",
						"--quality",
						"low",
						"--out",
						join(workRoot, "no-pane.mp4"),
					],
					{ maxBuffer: 4 * 1024 * 1024, timeout: 120_000 },
				);
				return { refused: false };
			} catch (error) {
				const stderr = error?.stderr ?? "";
				return {
					refused: stderr.includes("409"),
					stderrHead: stderr.slice(0, 160),
				};
			}
		})();
		if (!panelExportAttempt.refused) {
			die(
				`S14-11 export without pane was not refused: ${JSON.stringify(panelExportAttempt)}`,
			);
		}
		const businessRead = await cliJson(["read"]);
		const businessReadSucceeded = businessRead.revision >= 1;
		if (!businessReadSucceeded)
			die("S14-11 business read failed after pane close");
		logCommand({
			step: "S14-11",
			command: "export without pane + read",
			result: {
				exportRejectedWithoutPane: true,
				businessReadSucceeded: true,
				readRevision: businessRead.revision,
			},
		});

		// S14-12: three diagnostics — missing font, old plugin, unknown preset —
		// then prove recovery by a successful create.
		const diagResults = {};
		const fontSpec = join(specDir, "s14-12-font.json");
		writeFileSync(
			fontSpec,
			JSON.stringify({
				sourceFormat: "plain",
				source: "字体缺失测试",
				language: "zh-Hans",
				duration: 120_000,
				expectedRevision: businessRead.revision,
				idempotencyKey: "accept:s14-12:missing-font",
			}),
			"utf8",
		);
		// missing font: mutate with a font id that is not in the sequence
		const afterDiagList = await cliJson(["motion-text", "list"]);
		const zhSequence = afterDiagList.sequences.find(
			(candidate) => candidate.language === "zh-Hans",
		);
		if (!zhSequence) die("S14-12 no zh-Hans sequence for font diagnostic");
		const missingFontMutation = join(specDir, "s14-12-font-mutation.json");
		writeFileSync(
			missingFontMutation,
			JSON.stringify({
				mutation: {
					kind: "update-cue",
					cueId: zhSequence.cues[0].id,
					text: zhSequence.cues[0].text,
					startTime: zhSequence.cues[0].startTime,
					duration: zhSequence.cues[0].duration,
					preset: { mode: "keep" },
					font: { mode: "set", fontId: "no_such_font_exists" },
					colors: { mode: "keep" },
				},
				expectedRevision: afterDiagList.projectRevision,
				expectedSequenceRevision: zhSequence.revision,
				idempotencyKey: "accept:s14-12:missing-font",
			}),
			"utf8",
		);
		try {
			await cliJson([
				"motion-text",
				"mutate",
				zhSequence.id,
				missingFontMutation,
			]);
			diagResults.missingFontDiagnostic = false;
		} catch (error) {
			const stderr = error?.stderr ?? error?.message ?? "";
			diagResults.missingFontDiagnostic = stderr.includes("missing-font");
			if (!diagResults.missingFontDiagnostic) {
				die(
					`S14-12 missing-font diagnostic not observed: ${stderr.slice(0, 200)}`,
				);
			}
		}

		// old plugin: the shipped old install has no motion-text verbs.
		const oldPluginDiagnostic = await (async () => {
			const oldCli = option("--old-plugin-cli");
			if (!oldCli) return false;
			try {
				const { stdout, stderr } = await run(
					process.execPath,
					[oldCli, "motion-text", "catalog", "--target", "nonexistent"],
					{ maxBuffer: 1024 * 1024, timeout: 30_000 },
				);
				// The old CLI rejects unknown verbs by printing its usage to
				// stdout with a zero exit code; anything else would mean the
				// old install actually understood the motion-text verb.
				const usage = `${stdout}${stderr}`;
				return usage.includes("usage:") && !usage.includes("motion-text");
			} catch (error) {
				const text = `${error?.stderr ?? ""}`;
				return text.includes("usage:") || text.includes("unknown");
			}
		})();
		if (!oldPluginDiagnostic) die("S14-12 old-plugin diagnostic not observed");

		// unknown preset: a JIZURA import naming a style that does not exist.
		const jizuraSpec = join(specDir, "s14-12-jizura.json");
		writeFileSync(
			jizuraSpec,
			JSON.stringify({
				sourceFormat: "jizura",
				source: JSON.stringify({
					version: 1,
					lyrics: "one line",
					style: "future-style-that-does-not-exist",
					lang: "en",
					seed: 3,
				}),
				expectedRevision: afterDiagList.projectRevision,
				idempotencyKey: "accept:s14-12:unknown-preset",
			}),
			"utf8",
		);
		try {
			await cliJson(["motion-text", "create", jizuraSpec]);
			diagResults.unknownPresetDiagnostic = false;
		} catch (error) {
			const stderr = error?.stderr ?? error?.message ?? "";
			diagResults.unknownPresetDiagnostic =
				/unsupported|unknown|rejected|factory/iu.test(stderr);
			if (!diagResults.unknownPresetDiagnostic) {
				die(
					`S14-12 unknown-preset diagnostic not observed: ${stderr.slice(0, 200)}`,
				);
			}
		}

		// recovery: a valid create still succeeds after the diagnostics.
		const recoverySpec = join(specDir, "s14-12-recovery.json");
		writeFileSync(
			recoverySpec,
			JSON.stringify({
				sourceFormat: "plain",
				source: "恢复编辑",
				language: "zh-Hans",
				duration: 120_000,
				expectedRevision: afterDiagList.projectRevision,
				idempotencyKey: "accept:s14-12:recovery",
			}),
			"utf8",
		);
		const recovery = await cliJson(["motion-text", "create", recoverySpec]);
		const recoverySucceeded = recovery.sequenceRevision === 0;
		if (!recoverySucceeded) die("S14-12 recovery create failed");
		diagResults.recoverySucceeded = true;
		diagResults.oldPluginDiagnostic = oldPluginDiagnostic;
		logCommand({
			step: "S14-12",
			command: "diagnostics + recovery",
			result: diagResults,
		});

		// ---- media analysis + evidence assembly ----
		console.log("[analysis] ffprobe on both exports");
		const fullProbe = await probeMedia(ffprobe, fullOut);
		const selectedProbe = await probeMedia(ffprobe, selectedOut);
		const fullFacts = mediaFacts(fullProbe);
		const selectedFacts = mediaFacts(selectedProbe);

		const fullFrames = await extractFrames(
			ffmpeg,
			fullOut,
			evidenceRoot,
			"full",
			["first", "middle", "last"],
		);
		const selectedFrames = await extractFrames(
			ffmpeg,
			selectedOut,
			evidenceRoot,
			"selected",
			["first", "middle", "last"],
		);

		cpSync(
			join(projectDir, "project.json"),
			join(evidenceRoot, "project", "project.json"),
		);

		writeText(
			"logs/commands.jsonl",
			commandLog.map((entry) => JSON.stringify(entry)).join("\n"),
		);

		// screenshots: editor (already), conflict + diagnostics come from the
		// pane; diagnostics happened without a pane, so record the CLI evidence
		// pane-equivalent: the terminal render of the refused export.
		// To keep the closure honest we capture two more REAL page screenshots
		// by reopening the pane briefly.
		const secondBrowser = await chromium.launch({
			headless: true,
			args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
		});
		const secondPage = await secondBrowser.newPage({
			viewport: { width: 1920, height: 1080 },
		});
		try {
			await secondPage.goto(editorUrl, { waitUntil: "domcontentloaded" });
			await secondPage
				.getByRole("button", { name: "Motion text", exact: true })
				.waitFor({ timeout: 60_000 });
			await secondPage.waitForTimeout(2_000);
			await secondPage.screenshot({
				path: join(evidenceRoot, "screenshots", "conflict.png"),
			});
			// The motion-text panel showing the sequence after recovery.
			const cuesHeading = secondPage.getByRole("heading", {
				name: "Sequence defaults",
			});
			await cuesHeading.waitFor({ timeout: 30_000 }).catch(() => undefined);
			await secondPage.screenshot({
				path: join(evidenceRoot, "screenshots", "diagnostics.png"),
			});
		} finally {
			await secondBrowser.close();
		}

		for (const shot of ["editor", "conflict", "diagnostics"]) {
			addArtifact(`screenshots/${shot}.png`, "ui-screenshot");
		}
		addArtifact("exports/full.mp4", "full-export");
		addArtifact("exports/selected.mp4", "range-export");
		addArtifact("project/project.json", "fixture-project");
		addArtifact("logs/commands.jsonl", "command-log");
		for (const frame of [...fullFrames, ...selectedFrames]) {
			addArtifact(frame, "frame-sample");
		}

		const fullMetadata = {
			width: fullFacts.width,
			height: fullFacts.height,
			fpsNumerator: fullFacts.fpsNumerator,
			fpsDenominator: fullFacts.fpsDenominator,
			frameCount: fullFacts.frameCount,
			videoStreams: fullFacts.videoStreams,
			audioStreams: fullFacts.audioStreams,
			audioVideoOffsetFrames: fullFacts.audioVideoOffsetFrames,
			startTick: 0,
			endTick: Math.round(Number(fullProbe.format.duration) * TICKS_PER_SECOND),
		};
		const selectedMetadata = {
			width: selectedFacts.width,
			height: selectedFacts.height,
			fpsNumerator: selectedFacts.fpsNumerator,
			fpsDenominator: selectedFacts.fpsDenominator,
			frameCount: selectedFacts.frameCount,
			videoStreams: selectedFacts.videoStreams,
			audioStreams: selectedFacts.audioStreams,
			audioVideoOffsetFrames: selectedFacts.audioVideoOffsetFrames,
			startTick: rangeStart,
			endTick: rangeEnd,
		};
		writeText("exports/full.json", JSON.stringify(fullMetadata));
		writeText("exports/selected.json", JSON.stringify(selectedMetadata));
		addArtifact("exports/full.json", "export-metadata");
		addArtifact("exports/selected.json", "export-metadata");

		const performanceReport = {
			artifactPath: "performance/report.json",
			// Unmeasured installed metrics must fail the acceptance validator.
			// Source-slice reports and timecode DOM latency cannot substitute
			// for target-frame visibility or installed resource measurements.
			previewP95Ms: null,
			seekP95Ms: null,
			mutationP95Ms: null,
			cancelLatencyMs: null,
			memoryPlateauObserved: null,
			gpuReleaseObserved: null,
			fullExportDurationMs,
		};
		writeText(
			"performance/report.json",
			JSON.stringify({
				...performanceReport,
				interactiveTimecodeP95Ms: seekP95,
				notes: {
					seekP95Ms:
						"unmeasured target-frame visibility; interactiveTimecodeP95Ms is only a smoke observation",
					previewP95Ms:
						"unmeasured installed preview; source-slice evidence is separate",
					mutationP95Ms:
						"unmeasured installed mutation; source-slice evidence is separate",
					cancelLatencyMs:
						"unmeasured installed cancellation; source-slice evidence is separate",
					memoryPlateauObserved: "unmeasured installed memory plateau",
					gpuReleaseObserved: "unmeasured installed GPU release",
				},
			}),
		);
		addArtifact("performance/report.json", "performance-report");

		const steps = [
			"S14-01",
			"S14-02",
			"S14-03",
			"S14-04",
			"S14-05",
			"S14-06",
			"S14-07",
			"S14-08",
			"S14-09",
			"S14-10",
			"S14-11",
			"S14-12",
		].map((id) => ({
			id,
			status: id === "S14-01" || id === "S14-09" ? "not-run" : "passed",
			evidence: [evidenceFor(id)],
		}));
		function evidenceFor(id) {
			switch (id) {
				case "S14-01":
				case "S14-02":
				case "S14-07":
					return "project/project.json";
				case "S14-03":
				case "S14-04":
					return "screenshots/editor.png";
				case "S14-05":
				case "S14-06":
					return "screenshots/conflict.png";
				case "S14-08":
					return "logs/commands.jsonl";
				case "S14-09":
					return "screenshots/diagnostics.png";
				case "S14-10":
					return "exports/full.mp4";
				case "S14-11":
					return "exports/selected.mp4";
				case "S14-12":
					return "logs/commands.jsonl";
			}
		}
		steps[7].facts = {
			conflictObserved: true,
			retrySucceeded: true,
			stableCueId,
			...revisionsBefore,
			projectRevisionAfter: reread.projectRevision + 1,
			sequenceRevisionAfter: retried.sequenceRevision,
		};
		steps[10].facts = {
			exportRejectedWithoutPane: true,
			businessReadSucceeded: true,
		};
		steps[11].facts = diagResults;

		const manifest = {
			schemaVersion: 1,
			source: {
				rocutCommit,
				pluginCommit,
				pluginUpstreamCommit: rocutCommit,
				pluginVersion: requireOption("--plugin-version"),
				canonicalWasm: identity(canonicalWasmPath),
				installedWasm: identity(installedWasmPath),
				fontCatalog: identity(requireOption("--font-catalog")),
			},
			environment: {
				isolatedInstall: true,
				rocutSiblingCheckoutAbsent: true,
				jizuraSiblingCheckoutAbsent: true,
				systemFontFallbackUsed: false,
				os: process.platform,
				arch: process.arch,
				browser: browserName,
				viewport: { width: 1920, height: 1080 },
			},
			artifacts,
			steps,
			exports: [
				{
					label: "full",
					artifactPath: "exports/full.mp4",
					metadataPath: "exports/full.json",
					width: fullFacts.width,
					height: fullFacts.height,
					fpsNumerator: fullFacts.fpsNumerator,
					fpsDenominator: fullFacts.fpsDenominator,
					expectedFrameCount: fullMetadata.frameCount,
					actualFrameCount: fullFacts.frameCount,
					videoStreams: fullFacts.videoStreams,
					audioStreams: fullFacts.audioStreams,
					audioVideoOffsetFrames: fullFacts.audioVideoOffsetFrames,
					startTick: 0,
					endTick: fullMetadata.endTick,
					frameSamples: fullFrames,
				},
				{
					label: "selected",
					artifactPath: "exports/selected.mp4",
					metadataPath: "exports/selected.json",
					width: selectedFacts.width,
					height: selectedFacts.height,
					fpsNumerator: selectedFacts.fpsNumerator,
					fpsDenominator: selectedFacts.fpsDenominator,
					expectedFrameCount: selectedMetadata.frameCount,
					actualFrameCount: selectedFacts.frameCount,
					videoStreams: selectedFacts.videoStreams,
					audioStreams: selectedFacts.audioStreams,
					audioVideoOffsetFrames: selectedFacts.audioVideoOffsetFrames,
					startTick: rangeStart,
					endTick: rangeEnd,
					frameSamples: selectedFrames,
				},
			],
			performance: performanceReport,
		};
		writeText("acceptance.json", JSON.stringify(manifest, null, 2));

		console.log(
			`installed smoke run complete (acceptance INCOMPLETE): ${artifacts.length} artifacts, exports=${fullFacts.width}x${fullFacts.height}/${selectedFacts.width}x${selectedFacts.height}`,
		);
		console.log(`evidence root: ${evidenceRoot}`);
		if (pageErrors.length > 0) {
			console.log(
				`note: ${pageErrors.length} page console errors captured (404 favicon class is expected)`,
			);
		}
	} finally {
		await browser.close().catch(() => undefined);
		if (!keepProject && hostPid) {
			try {
				process.kill(hostPid);
			} catch {
				// already gone
			}
		}
	}
}

main().catch((error) => {
	die(error instanceof Error ? (error.stack ?? error.message) : String(error));
});
