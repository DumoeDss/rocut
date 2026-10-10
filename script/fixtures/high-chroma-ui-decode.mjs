import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { highChromaUiContract as contract } from "./high-chroma-ui-contract.mjs";

export function assertHighChromaUiMedia(metadata) {
	assert.equal(metadata.streams?.length, 1, "One video stream, no audio");
	const [stream] = metadata.streams;
	assert.equal(stream.codec_type, "video");
	assert.equal(stream.codec_name, contract.codec);
	assert.equal(stream.profile, contract.profile);
	assert.equal(stream.pix_fmt, contract.pixelFormat);
	assert.equal(stream.width, contract.width);
	assert.equal(stream.height, contract.height);
	assert.equal(Number(stream.nb_read_frames), contract.frames);
	assert.equal(metadata.frames?.length, contract.frames);
	for (const [index, frame] of metadata.frames.entries()) {
		assert.equal(frame.media_type, "video");
		assert.equal(frame.width, contract.width);
		assert.equal(frame.height, contract.height);
		assert.equal(frame.pix_fmt, contract.pixelFormat);
		const timestamp = Number(frame.best_effort_timestamp_time);
		assert(Number.isFinite(timestamp));
		assert(
			Math.abs(timestamp - index / contract.fps) <=
				contract.timestampToleranceSeconds,
			`Frame ${index} timestamp ${timestamp}`,
		);
	}
	return {
		codec: stream.codec_name,
		profile: stream.profile,
		pixelFormat: stream.pix_fmt,
		width: stream.width,
		height: stream.height,
		frames: metadata.frames.length,
		timestamps: metadata.frames.map((frame) =>
			Number(frame.best_effort_timestamp_time),
		),
	};
}

export async function inspectHighChromaUiMedia({
	mediaPath,
	artifacts,
	label,
	ffmpegDirectory,
}) {
	assert([mediaPath, artifacts, ffmpegDirectory].every(isAbsolute));
	assert(/^(ui|host)$/.test(label));
	const executable = join(ffmpegDirectory, "ffprobe.exe");
	const args = [
		"-v",
		"error",
		"-count_frames",
		"-show_streams",
		"-show_frames",
		"-of",
		"json",
		mediaPath,
	];
	const metadata = await new Promise((resolve, reject) => {
		const child = spawn(executable, args, {
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"],
			timeout: 30000,
		});
		let stdout = "",
			stderr = "";
		child.on("error", reject);
		child.stdout.on("data", (chunk) => {
			stdout += chunk.toString();
			if (stdout.length > 1024 * 1024) {
				child.kill();
				reject(Error("ffprobe metadata exceeded the six-frame bound"));
			}
		});
		child.stderr.on("data", (chunk) => {
			stderr = (stderr + chunk.toString()).slice(-4000);
		});
		child.on("close", (code) => {
			if (code !== 0) {
				reject(Error(`ffprobe failed (${code}): ${stderr}`));
				return;
			}
			try {
				resolve(JSON.parse(stdout));
			} catch (error) {
				reject(error);
			}
		});
	});
	await writeFile(
		join(artifacts, `${label}-ffprobe.json`),
		JSON.stringify(metadata, null, 2),
		{ flag: "wx" },
	);
	const inspected = assertHighChromaUiMedia(metadata);
	const bytes = await readFile(mediaPath);
	return {
		...inspected,
		bytes: bytes.length,
		sha256: createHash("sha256").update(bytes).digest("hex"),
		path: mediaPath,
		inspector: executable,
		method: "Independent ffprobe stream/frame inspection; no pixel comparison",
	};
}
