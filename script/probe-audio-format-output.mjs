import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { isAbsolute, join, relative } from "node:path";
import { expect } from "@playwright/test";

// Observe the actual realtime output, not a separately decoded test file.
// Record native destination connections without changing them; attach a passive
// analyser branch after Play has constructed the production graph.
export async function attachAudioOutputObserver(page) {
	await page.evaluate(() => {
		if (globalThis.__audioOutputProbe) return;
		const connect = AudioNode.prototype.connect;
		const probe = { connect, outputs: [], taps: [] };
		globalThis.__audioOutputProbe = probe;
		AudioNode.prototype.connect = function (destination, output = 0) {
			const result = connect.apply(this, arguments);
			if (
				this.context instanceof AudioContext &&
				destination === this.context.destination
			) {
				probe.outputs.push({ source: this, output });
			}
			return result;
		};
	});
}

export async function observeAudioPlayback(page, { silent = false } = {}) {
	await page.getByLabel("Edit playhead time", { exact: true }).click();
	await page.getByLabel("Playhead time", { exact: true }).fill("00:00:00:00");
	await page.getByLabel("Playhead time", { exact: true }).press("Enter");
	await page.getByLabel("Play preview", { exact: true }).click();
	let result;
	try {
		result = await page.evaluate(async () => {
			const probe = globalThis.__audioOutputProbe;
			for (const output of probe.outputs.splice(0)) {
				const analyser = output.source.context.createAnalyser();
				analyser.fftSize = 4096;
				probe.connect.call(output.source, analyser, output.output, 0);
				probe.taps.push(analyser);
			}
			let maxRms = 0,
				frequency = 0,
				running = false,
				audioSeconds = 0;
			const start = performance.now(),
				audioStarts = new Map();
			while (performance.now() - start < 1200) {
				for (const analyser of probe.taps) {
					if (!audioStarts.has(analyser))
						audioStarts.set(analyser, analyser.context.currentTime);
					audioSeconds = Math.max(
						audioSeconds,
						analyser.context.currentTime - audioStarts.get(analyser),
					);
					running ||= analyser.context.state === "running";
					const samples = new Float32Array(analyser.fftSize);
					analyser.getFloatTimeDomainData(samples);
					const rms = Math.sqrt(
						samples.reduce((total, value) => total + value * value, 0) /
							samples.length,
					);
					if (rms > maxRms) {
						maxRms = rms;
						const bins = new Float32Array(analyser.frequencyBinCount);
						analyser.getFloatFrequencyData(bins);
						let peak = 1;
						for (let i = 2; i < bins.length; i++)
							if (bins[i] > bins[peak]) peak = i;
						frequency = (peak * analyser.context.sampleRate) / analyser.fftSize;
					}
				}
				await new Promise((resolve) => setTimeout(resolve, 20));
			}
			return { maxRms, frequency, running, audioSeconds };
		});
	} finally {
		const pause = page.getByLabel("Pause preview", { exact: true });
		if (await pause.count()) await pause.click();
	}
	assert(result.running, "Actual realtime audio context must run");
	assert(
		result.audioSeconds > 0.8,
		"Realtime output clock must advance during observation: " +
			JSON.stringify(result),
	);
	if (silent)
		assert(
			result.maxRms < 0.0001,
			"Muted preview must be silent: " + JSON.stringify(result),
		);
	else {
		assert(
			result.maxRms > 0.015,
			"Preview must emit real audio: " + JSON.stringify(result),
		);
		assert(
			Math.abs(result.frequency - 880) < 30,
			"Preview must reproduce the source tone",
		);
	}
	return result;
}

export async function inspectAudioExport(
	page,
	project,
	{ silent = false } = {},
) {
	const started = await page.evaluate(async () => {
		const response = await fetch(new URL("api/export", location.href), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				format: "mp4",
				quality: "low",
				includeAudio: true,
				range: { startTime: 30000, endTime: 210000 },
			}),
		});
		return { status: response.status, job: await response.json() };
	});
	assert.equal(started.status, 202, JSON.stringify(started));
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
	const rel = relative(join(project, "exports"), job.outputPath);
	assert(rel && !rel.startsWith("..") && !isAbsolute(rel));
	const metadata = JSON.parse(
		execFileSync(
			"ffprobe",
			[
				"-v",
				"error",
				"-show_streams",
				"-show_format",
				"-of",
				"json",
				job.outputPath,
			],
			{ encoding: "utf8", windowsHide: true },
		),
	);
	assert(
		Math.abs(Number(metadata.format.duration) - 1.5) < 0.15,
		"Ranged output must last 1.5 seconds",
	);
	const audio = metadata.streams.filter((s) => s.codec_type === "audio");
	if (silent && audio.length === 0)
		return {
			duration: metadata.format.duration,
			rms: 0,
			frequency: 0,
			audioStreams: 0,
		};
	assert.equal(audio.length, 1, "One encoded audio stream expected");
	const pcm = execFileSync(
		"ffmpeg",
		[
			"-v",
			"error",
			"-i",
			job.outputPath,
			"-vn",
			"-ac",
			"1",
			"-ar",
			"8000",
			"-f",
			"f32le",
			"pipe:1",
		],
		{ windowsHide: true },
	);
	const count = pcm.length / 4;
	let energy = 0,
		crossings = 0,
		previous = 0;
	for (let i = 0; i < count; i++) {
		const value = pcm.readFloatLE(i * 4);
		energy += value * value;
		if (previous <= 0 && value > 0) crossings++;
		previous = value;
	}
	const rms = Math.sqrt(energy / count),
		frequency = crossings / (count / 8000);
	if (silent) assert(rms < 0.0001, "Muted export must be silent");
	else {
		assert(rms > 0.015, "Export must contain real audio");
		assert(
			Math.abs(frequency - 880) < 15,
			"Export must reproduce the source tone: " + frequency,
		);
	}
	return {
		duration: metadata.format.duration,
		rms,
		frequency,
		audioStreams: audio.length,
	};
}
