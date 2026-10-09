import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
	copyFile,
	lstat,
	mkdir,
	readFile,
	readdir,
	realpath,
	writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { runProbeChild } from "./probe-child-lifecycle.mjs";

export const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const readJson = async (path) =>
	JSON.parse(
		new TextDecoder("utf-8", { fatal: true }).decode(await readFile(path)),
	);
export const writeJson = (path, value) =>
	writeFile(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
export function inside(parent, target) {
	const tail = relative(resolve(parent), resolve(target));
	return (
		tail !== "" &&
		tail !== ".." &&
		!tail.startsWith(`..${sep}`) &&
		!isAbsolute(tail)
	);
}
export async function plain(path, directory) {
	const info = await lstat(path);
	assert.equal(
		info.isSymbolicLink(),
		false,
		"Links/junctions are not accepted",
	);
	assert.equal(directory ? info.isDirectory() : info.isFile(), true);
	assert.equal(
		(await realpath(path)).toLowerCase(),
		resolve(path).toLowerCase(),
		"Redirected path rejected",
	);
}

export async function treeManifest(root) {
	await plain(root, true);
	const files = [],
		directories = [];
	async function visit(directory) {
		for (const name of (await readdir(directory)).sort()) {
			const path = join(directory, name),
				info = await lstat(path);
			assert.ok(inside(root, path));
			assert.equal(
				info.isSymbolicLink(),
				false,
				"Project contains a link/junction",
			);
			if (info.isDirectory()) {
				await plain(path, true);
				directories.push(relative(root, path).replaceAll("\\", "/"));
				await visit(path);
			} else {
				await plain(path, false);
				const bytes = await readFile(path);
				files.push({
					path: relative(root, path).replaceAll("\\", "/"),
					bytes: bytes.length,
					sha256: hash(bytes),
				});
			}
		}
	}
	await visit(root);
	return {
		directories: directories.sort(),
		files: files.sort((a, b) => a.path.localeCompare(b.path)),
	};
}

export async function copyProject(source, destination) {
	const before = await treeManifest(source);
	assert.ok(before.files.some((file) => file.path === "project.json"));
	await mkdir(destination);
	for (const directory of before.directories)
		await mkdir(join(destination, directory));
	for (const file of before.files) {
		await plain(join(source, file.path), false);
		await copyFile(
			join(source, file.path),
			join(destination, file.path),
			constants.COPYFILE_EXCL,
		);
	}
	assert.deepEqual(
		await treeManifest(source),
		before,
		"Source project changed while copying",
	);
	assert.deepEqual(
		await treeManifest(destination),
		before,
		"Private project copy differs",
	);
	return before;
}

// No raw host stdout/stderr is persisted or forwarded: only the private ready
// file may contain the editor capability URL. The fixture writes redacted errors.
export function startPrivateHost({ executable, args, cwd, env, root }) {
	const state = {
		spawned: false,
		closed: false,
		code: null,
		signal: null,
		stopRequested: false,
		killAttempted: false,
		stdoutBytes: 0,
		stderrBytes: 0,
		errors: [],
		scope: "direct private Host process; no descendant inference",
	};
	const child = spawn(executable, args, {
		cwd,
		env,
		windowsHide: true,
		stdio: ["pipe", "pipe", "pipe"],
	});
	state.spawned = !!child.pid;
	if (child.pid) state.pid = child.pid;
	child.stdout.on("data", (bytes) => {
		state.stdoutBytes += bytes.length;
	});
	child.stderr.on("data", (bytes) => {
		state.stderrBytes += bytes.length;
	});
	child.on("error", (error) =>
		state.errors.push(`Host process error: ${error.code || error.name}`),
	);
	child.stdin.on("error", (error) =>
		state.errors.push(`Host stdin error: ${error.code || error.name}`),
	);
	let closeResolve;
	const closed = new Promise((done) => {
		closeResolve = done;
	});
	child.once("close", (code, signal) => {
		Object.assign(state, { closed: true, code, signal });
		closeResolve();
	});
	async function waitClose(milliseconds) {
		if (state.closed) return true;
		let timer;
		try {
			return await Promise.race([
				closed.then(() => true),
				new Promise((done) => {
					timer = setTimeout(() => done(false), milliseconds);
				}),
			]);
		} finally {
			clearTimeout(timer);
		}
	}
	return {
		async ready() {
			const deadline = Date.now() + 90_000;
			while (Date.now() < deadline) {
				if (state.closed || state.errors.length)
					throw Error(
						"Private Host failed before readiness; inspect redacted host-failure.json",
					);
				try {
					const ready = await readJson(join(root, "host-ready.private.json"));
					const url = new URL(ready.editorUrl);
					assert.equal(url.hostname, "127.0.0.1");
					assert.equal(url.protocol, "http:");
					assert.ok(ready.token && url.pathname.includes(ready.token));
					return ready;
				} catch (error) {
					if (error.code !== "ENOENT") throw error;
				}
				await delay(100);
			}
			throw Error("Private Host readiness deadline exceeded");
		},
		async stop() {
			state.stopRequested = true;
			if (!state.closed) child.stdin.end("stop\n");
			if (!(await waitClose(15_000))) {
				state.killAttempted = true;
				try {
					state.killReturned = child.kill();
				} catch (error) {
					state.errors.push(`Host kill error: ${error.code || error.name}`);
				}
				await waitClose(5000);
			}
			if (!state.closed)
				state.errors.push(
					"Direct Host close not confirmed before cleanup deadline",
				);
			if (state.code !== 0 || state.killAttempted)
				state.errors.push("Host did not complete a clean graceful shutdown");
			await writeJson(join(root, "host-process-lifecycle.json"), state);
			if (state.errors.length) throw Error(state.errors.join("; "));
			return { ...state };
		},
	};
}

export async function nativeCommand(executable, args, root, label) {
	let output = "",
		lifecycle;
	try {
		lifecycle = await runProbeChild({
			executable,
			args,
			cwd: root,
			env: {
				...process.env,
				TEMP: join(root, "temp"),
				TMP: join(root, "temp"),
				TMPDIR: join(root, "temp"),
			},
			timeoutMs: 60_000,
			onOutput(bytes) {
				output += bytes.toString("utf8");
				if (output.length > 1_000_000)
					throw Error("Native diagnostic output exceeded its bound");
			},
		});
	} catch (error) {
		lifecycle = error.lifecycle;
		throw error;
	} finally {
		await writeFile(join(root, `${label}.log`), output, { flag: "wx" });
		await writeJson(
			join(root, `${label}-lifecycle.json`),
			lifecycle ?? { status: "failed", closed: false },
		);
	}
	return { output, lifecycle };
}

export async function verifyVideo({
	root,
	ffmpeg,
	ffprobe,
	width,
	height,
	references,
}) {
	const video = join(root, "particle.webm");
	const probe = await nativeCommand(
		ffprobe,
		[
			"-v",
			"error",
			"-select_streams",
			"v:0",
			"-count_frames",
			"-show_entries",
			"stream=codec_name,width,height,r_frame_rate,avg_frame_rate,nb_read_frames:format=duration",
			"-of",
			"json",
			video,
		],
		root,
		"ffprobe",
	);
	const metadata = JSON.parse(probe.output),
		stream = metadata.streams?.[0];
	assert.equal(metadata.streams?.length, 1);
	assert.equal(stream.width, width);
	assert.equal(stream.height, height);
	assert.equal(Number(stream.nb_read_frames), 6);
	for (const key of ["r_frame_rate", "avg_frame_rate"]) {
		const [numerator, denominator] = String(stream[key]).split("/").map(Number);
		assert.ok(
			denominator > 0 && numerator / denominator === 30,
			`Unexpected ${key}`,
		);
	}
	const durationSeconds = Number(metadata.format?.duration);
	assert.ok(
		Number.isFinite(durationSeconds) &&
			Math.abs(durationSeconds - 0.2) <= 0.001 + Number.EPSILON,
		"Container duration must be 0.2 seconds within the predeclared 1 ms tolerance",
	);
	const decodedFile = join(root, "decoded.rgba");
	const decoded = await nativeCommand(
		ffmpeg,
		[
			"-v",
			"error",
			"-nostdin",
			"-n",
			"-i",
			video,
			"-map",
			"0:v:0",
			"-fps_mode",
			"passthrough",
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgba",
			decodedFile,
		],
		root,
		"ffmpeg-decode",
	);
	const rgba = await readFile(decodedFile),
		frameBytes = width * height * 4;
	assert.equal(
		rgba.length,
		frameBytes * 6,
		"Independent decode must contain exactly six full-size frames",
	);
	const frames = references.map((reference, index) => {
		assert.equal(reference.index, index);
		assert.equal(reference.rgba.length, frameBytes);
		let error = 0,
			activeError = 0,
			activePixels = 0;
		for (let pixel = 0; pixel < width * height; pixel++) {
			const offset = pixel * 4,
				active =
					reference.rgba[offset] > 8 ||
					reference.rgba[offset + 1] > 8 ||
					reference.rgba[offset + 2] > 8;
			if (active) activePixels++;
			for (let channel = 0; channel < 3; channel++) {
				const difference = Math.abs(
					reference.rgba[offset + channel] -
						rgba[index * frameBytes + offset + channel],
				);
				error += difference;
				if (active) activeError += difference;
			}
		}
		assert.ok(activePixels > 0, "Reference active mask must not be empty");
		return {
			index,
			activePixels,
			meanRgbError: error / (width * height * 3),
			activeMeanRgbError: activeError / (activePixels * 3),
		};
	});
	const result = {
		metadata,
		frameCount: 6,
		durationSeconds,
		expectedDurationSeconds: 0.2,
		durationToleranceSeconds: 0.001,
		width,
		height,
		limits: {
			meanRgbError: 12,
			activeMeanRgbError: 18,
			activeChannelThreshold: 8,
		},
		frames,
		decoder: "independent FFmpeg full RGB / reference-active RGB comparison",
		ffprobeLifecycle: probe.lifecycle,
		ffmpegLifecycle: decoded.lifecycle,
	};
	await writeJson(join(root, "decode-verification.json"), result);
	for (const frame of frames) {
		assert.ok(
			frame.meanRgbError <= 12,
			`Frame ${frame.index} whole RGB mean error exceeds 12`,
		);
		assert.ok(
			frame.activeMeanRgbError <= 18,
			`Frame ${frame.index} active RGB mean error exceeds 18`,
		);
	}
	return result;
}
