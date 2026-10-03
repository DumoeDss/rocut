import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { isAbsolute, join, relative } from "node:path";
import { expect } from "@playwright/test";

// Exercise the host export command and real attached surface encoder. This is
// not an assertion about an Elftia UI entry point or the installed plugin.
export async function probeMixedExport(frame, project, evidence) {
	await expect.poll(() => frame.evaluate(async () =>
		(await (await fetch(new URL("api/export", location.href))).json()).surfaces,
	)).toBe(1);
	const started = await frame.evaluate(async () => {
		const response = await fetch(new URL("api/export", location.href), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ format: "mp4", quality: "low", includeAudio: true,
				range: { startTime: 120000, endTime: 480000 } }),
		});
		return { status: response.status, job: await response.json() };
	});
	assert.equal(started.status, 202);
	let job;
	await expect.poll(async () => {
		job = await frame.evaluate(async id =>
			(await fetch(new URL(`api/export/${id}`, location.href))).json(), started.job.id);
		return ["completed", "failed", "cancelled"].includes(job.status);
	}, { timeout: 120000, intervals: [250, 500, 1000] }).toBe(true);
	evidence.checks.push({ name: "mixed ranged export job", status: job.status, error: job.error });
	assert.equal(job.status, "completed", job.error);
	const exportRelative = relative(join(project, "exports"), job.outputPath);
	assert(exportRelative && !exportRelative.startsWith("..") && !isAbsolute(exportRelative));
	const metadata = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", job.outputPath], { encoding: "utf8", windowsHide: true }));
	assert.equal(metadata.streams.filter(stream => stream.codec_type === "video").length, 1);
	assert.equal(metadata.streams.filter(stream => stream.codec_type === "audio").length, 1);
	assert(Math.abs(Number(metadata.format.duration) - 3) < 0.15, "Export must honor the three-second range");
	const pixels = execFileSync("ffmpeg", ["-v", "error", "-ss", "1", "-i", job.outputPath, "-frames:v", "1", "-vf", "scale=320:180", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], { windowsHide: true });
	let red = 0, light = 0;
	for (let i = 0; i < pixels.length; i += 3) {
		if (pixels[i] > 150 && pixels[i + 1] < 100 && pixels[i + 2] < 100) red++;
		if (pixels[i] > 180 && pixels[i + 1] > 180 && pixels[i + 2] > 180) light++;
	}
	const count = pixels.length / 3;
	assert(count > 0 && red / count > 0.4, "Exported pixels must include the fixture video");
	assert(light / count > 0.001, "Exported pixels must include motion-text glyphs");
	const pcm = execFileSync("ffmpeg", ["-v", "error", "-i", job.outputPath, "-vn", "-ac", "1", "-ar", "8000", "-f", "f32le", "pipe:1"], { windowsHide: true });
	let energy = 0;
	for (let i = 0; i < pcm.length; i += 4) energy += pcm.readFloatLE(i) ** 2;
	const rms = Math.sqrt(energy / (pcm.length / 4));
	assert(rms > 0.01, "Export audio must be audible, not a silent placeholder");
	evidence.checks.push({ name: "mixed ranged MP4 decoded video/text/audio", duration: metadata.format.duration, redFraction: red / count, lightFraction: light / count, rms, pass: true });
}
