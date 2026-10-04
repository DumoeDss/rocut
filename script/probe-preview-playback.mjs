import assert from "node:assert/strict";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { expect } from "@playwright/test";
import { attachAudioOutputObserver } from "./probe-audio-format-output.mjs";

export async function probePreviewPlayback({
	page,
	hostPage,
	work,
	evidence,
	onPhase,
}) {
	const result = {
		name: "F04 sustained 180 second playback",
		measurement:
			"preview call to successful render submission including lock/resolve/upload; NOT GPU completion or visible frame presentation",
		warmupSeconds: 5,
		submissionBudgetMs: 33.3,
		frames: [],
		clocks: [],
		screenshots: [],
		pass: false,
	};
	evidence.playback = result;
	const persist = () =>
		writeFileSync(join(work, "playback.json"), JSON.stringify(result, null, 2));
	onPhase("F04 configure actual 720p preview");
	await page.getByLabel("Settings", { exact: true }).click();
	await page.getByRole("button", { name: "Custom", exact: true }).click();
	for (const [name, value] of [
		["Canvas width", "1280"],
		["Canvas height", "720"],
	]) {
		const input = page.getByLabel(name, { exact: true });
		await input.fill(value);
		await input.press("Tab");
	}
	await expect
		.poll(() =>
			page.evaluate(
				async () =>
					(await (await fetch(new URL("api/record", location.href))).json())
						.record.data.settings.canvasSize,
			),
		)
		.toEqual({ width: 1280, height: 720 });
	await page.getByLabel("Media", { exact: true }).click();
	const canvas = page.locator('canvas[width="1280"][height="720"]');
	await expect(canvas).toBeVisible();
	await page.getByLabel("Edit playhead time", { exact: true }).click();
	await page.getByLabel("Playhead time", { exact: true }).fill("00:00:00:00");
	await page.getByLabel("Playhead time", { exact: true }).press("Enter");
	result.environment = await page.evaluate(async () => {
		await document.fonts.ready;
		const record = (
			await (await fetch(new URL("api/record", location.href))).json()
		).record;
		return {
			settings: record.data.settings,
			cueCount: record.data.motionTextSequences[0].cues.length,
			userAgent: navigator.userAgent,
			hardwareConcurrency: navigator.hardwareConcurrency,
			visibility: document.visibilityState,
			fonts: [...document.fonts].map((f) => ({
				family: f.family,
				status: f.status,
			})),
		};
	});
	assert.equal(result.environment.cueCount, 120);
	assert.deepEqual(result.environment.settings.fps, {
		numerator: 30,
		denominator: 1,
	});
	await attachAudioOutputObserver(page);
	await page.evaluate(() => {
		window.__rocutPreviewPerf = { samples: [], droppedSamples: 0 };
	});
	const readObservation = () =>
		page.evaluate(() => {
			const probe = globalThis.__audioOutputProbe;
			for (const output of probe.outputs.splice(0)) {
				const analyser = output.source.context.createAnalyser();
				analyser.fftSize = 2048;
				probe.connect.call(output.source, analyser, output.output, 0);
				probe.taps.push(analyser);
				(probe.connections ??= []).push({ source: output.source, analyser });
			}
			const audio = probe.taps.map((analyser) => {
				const data = new Float32Array(analyser.fftSize);
				analyser.getFloatTimeDomainData(data);
				return {
					time: analyser.context.currentTime,
					state: analyser.context.state,
					rms: Math.sqrt(
						data.reduce((n, value) => n + value * value, 0) / data.length,
					),
				};
			});
			const timecode = document
				.querySelector('[aria-label="Edit playhead time"]')
				?.textContent?.trim();
			const parts = timecode?.split(":").map(Number);
			const seconds =
				parts?.length === 4
					? parts[0] * 3600 + parts[1] * 60 + parts[2] + parts[3] / 30
					: null;
			return {
				at: performance.now(),
				frames: window.__rocutPreviewPerf.samples.splice(0),
				droppedSamples: window.__rocutPreviewPerf.droppedSamples,
				clock: {
					timecode,
					seconds,
					audio,
					visibility: document.visibilityState,
					playing: !!document.querySelector('[aria-label="Pause preview"]'),
				},
			};
		});
	let started;
	result.projectWrites = [];
	const onRequest = (request) => {
		if (
			started !== undefined &&
			request.method() === "PUT" &&
			request.url().endsWith("/api/record")
		) {
			result.projectWrites.push({ elapsedMs: performance.now() - started });
		}
	};
	hostPage.on("request", onRequest);
	try {
		onPhase("F04 full continuous playback with real audio");
		await page.getByLabel("Play preview", { exact: true }).click();
		started = performance.now();
		let nextScreenshot = 10;
		while (performance.now() - started < 210000) {
			const observation = await readObservation();
			result.frames.push(...observation.frames);
			result.clocks.push({ at: observation.at, ...observation.clock });
			assert.equal(
				observation.droppedSamples,
				0,
				"Diagnostic sample overflow invalidates measurement",
			);
			const seconds = observation.clock.seconds;
			assert(Number.isFinite(seconds), "Actual UI playhead must be readable");
			if (seconds >= nextScreenshot) {
				const path = join(work, "playback-" + Math.floor(seconds) + ".png");
				await hostPage.screenshot({ path });
				result.screenshots.push({ seconds, path });
				nextScreenshot =
					nextScreenshot === 10 ? 90 : nextScreenshot === 90 ? 179 : Infinity;
			}
			if (result.clocks.length % 15 === 0) {
				console.log(
					"playback progress",
					JSON.stringify({ seconds, frames: result.frames.length }),
				);
				persist();
			}
			if (!observation.clock.playing && seconds >= 179.9) break;
			assert(
				performance.now() - started < 10000 || seconds > 1,
				"Playback stalled at startup",
			);
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}
		result.wallMs = performance.now() - started;
		result.steadyPlaybackWrites = result.projectWrites.filter(
			(write) =>
				write.elapsedMs >= 5000 && write.elapsedMs < result.wallMs - 2000,
		);
		persist();
		assert.equal(
			result.steadyPlaybackWrites.length,
			0,
			"Playback-follow scrolling must not repeatedly upload the whole project",
		);
		assert(
			result.clocks.at(-1).seconds >= 179.9,
			"Playback did not reach the complete F04 ending",
		);
		assert(
			result.frames.length > 0,
			"Installed preview timing instrumentation must produce samples",
		);
		assert(
			result.frames.every(
				(f) => f.completed && f.width === 1280 && f.height === 720,
			),
			"Every observed preview must complete at 720p",
		);
		assert(
			result.clocks.every((c) => c.visibility === "visible"),
			"Background throttling invalidates this foreground fixture",
		);
		const warm = result.frames.filter(
			(f) => f.time >= 5 * 120000 && f.time < 179 * 120000,
		);
		const costs = warm.map((f) => f.durationMs).sort((a, b) => a - b);
		assert(costs.length > 100, "Require actual sustained render samples");
		const gaps = warm.slice(1).map((f, i) => (f.time - warm[i].time) / 120000);
		assert(
			gaps.every((gap) => gap >= 0),
			"Playback frames must not run backwards",
		);
		result.summary = {
			frameCount: result.frames.length,
			warmFrameCount: warm.length,
			p95SubmissionMs: costs[Math.ceil(costs.length * 0.95) - 1],
			maxSubmissionMs: costs.at(-1),
			maximumTimelineGapSeconds: Math.max(...gaps),
			submittedFps:
				(warm.length - 1) / ((warm.at(-1).time - warm[0].time) / 120000),
		};
		const audible = result.clocks.filter(
			(c) => c.seconds >= 5 && c.seconds <= 178,
		);
		assert(
			audible.every((c) =>
				c.audio.some((a) => a.state === "running" && a.rms > 0.015),
			),
			"Real source audio must remain audible across the full timeline",
		);
		const first = audible[0],
			last = audible.at(-1);
		const audioProgress = last.audio[0].time - first.audio[0].time;
		result.summary.audioProgressSeconds = audioProgress;
		result.summary.playheadProgressSeconds = last.seconds - first.seconds;
		result.summary.audioProgressDifferenceSeconds = Math.abs(
			audioProgress - (last.seconds - first.seconds),
		);
		assert(
			result.summary.audioProgressDifferenceSeconds < 0.15,
			"Audio and playhead progression must remain aligned (not a visible-frame AV-sync claim)",
		);
		evidence.checks.push({
			name: "F04 full foreground playback reaches end with sustained real source audio",
			pass: true,
			...result.summary,
		});
		result.submissionBudgetPassed = result.summary.p95SubmissionMs <= 33.3;
		evidence.checks.push({
			name: "F04 warm preview submission p95 <= 33.3ms (GPU/display completion unmeasured)",
			pass: result.submissionBudgetPassed,
			...result.summary,
		});
		assert(
			result.submissionBudgetPassed,
			"F04 submission p95 exceeds unchanged 33.3ms budget: " +
				result.summary.p95SubmissionMs,
		);
		result.pass = true;
	} finally {
		hostPage.off("request", onRequest);
		const pause = page.getByLabel("Pause preview", { exact: true });
		if (await pause.count()) await pause.click();
		await page.evaluate(() => {
			delete window.__rocutPreviewPerf;
			const probe = globalThis.__audioOutputProbe;
			for (const { source, analyser } of probe?.connections ?? []) {
				source.disconnect(analyser);
				analyser.disconnect();
			}
			if (probe) AudioNode.prototype.connect = probe.connect;
			delete globalThis.__audioOutputProbe;
		});
		persist();
	}
}
