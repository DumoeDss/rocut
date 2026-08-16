/**
 * sdk-export-capability — `ExportJobManager` behavior under `bun test`, with
 * the REAL FFmpeg binary injected via the constructor (task B3). No Electron:
 * the class is pure Node, and this suite is the evidence that the unit path
 * and the production path (main.cjs installs this exact class over IPC) are
 * one implementation.
 *
 * Synthetic workload (deterministic, no editor, no canvas):
 *
 * - frames: a per-frame gradient over RGB24 (`(x+i)%256` and friends) —
 *   every byte set, every run byte-identical;
 * - audio: a hand-rolled 44.1 kHz stereo 16-bit WAV (two detuned sines),
 *   the same shape `extractTimelineAudio` produces;
 * - verification: `ffprobe -show_streams/-count_frames` over the produced
 *   file — stream counts, dimensions, duration, frame count.
 *
 * The cancel-mid-encode leg proves child teardown structurally: `cancelJob`
 * resolves only after the child's exit gate released (it awaits the exit
 * promise through SIGTERM→SIGKILL), so a resolved cancel IS the exited-child
 * proof — plus the partial file is gone.
 */
import { afterAll, expect, test } from "bun:test";
import {
	appendFileSync,
	existsSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	truncateSync,
} from "node:fs";
import { join } from "node:path";
import type { ExportJobEvent, ExportJobRequest } from "@opencut/editor-ports/export-jobs";
import {
	ExportJobManager,
	ExportJobManagerError,
	FRAME_STREAM_DESYNC_REASON,
	RAW_STREAM_SHORT_REASON,
} from "../job-manager";

const FFMPEG = "E:/Software/ffmpeg-6.0-full_build/bin/ffmpeg.exe";
const FFPROBE = "E:/Software/ffmpeg-6.0-full_build/bin/ffprobe.exe";
const SCRATCH = "E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-export-scratch";

if (!existsSync(FFMPEG) || !existsSync(FFPROBE)) {
	throw new Error(`job-manager tests need the ffmpeg suite at ${FFMPEG}`);
}

/** 320x180 @ 30/1, 2 s = 60 frames (the task's happy-path workload). */
const SPEC_180 = {
	width: 320,
	height: 180,
	fps: { numerator: 30, denominator: 1 },
	totalFrames: 60,
} as const;

/** 640x360 @ 30/1, 8 s = 240 frames — long enough to cancel mid-encode. */
const SPEC_360 = {
	width: 640,
	height: 360,
	fps: { numerator: 30, denominator: 1 },
	totalFrames: 240,
} as const;

const roots: string[] = [];
const managers: ExportJobManager[] = [];

function freshRoot(): string {
	roots.push(join(SCRATCH, `job-manager-test-${roots.length + 1}`));
	const root = roots[roots.length - 1];
	rmSync(root, { recursive: true, force: true });
	return root;
}

function newManager(root: string): ExportJobManager {
	const manager = new ExportJobManager({ root, ffmpegPath: FFMPEG });
	managers.push(manager);
	return manager;
}

afterAll(async () => {
	for (const manager of managers) {
		await manager.dispose();
	}
	for (const root of roots) {
		rmSync(root, { recursive: true, force: true });
	}
});

// -- synthetic payloads -----------------------------------------------------

/** Deterministic RGB24 gradient frames: `(x+i)`, `(y+2i)`, `(x+y+i)` mod 256. */
function makeFrames(args: {
	count: number;
	width: number;
	height: number;
}): Uint8Array {
	const frameBytes = args.width * args.height * 3;
	const out = new Uint8Array(frameBytes * args.count);
	for (let i = 0; i < args.count; i += 1) {
		const base = i * frameBytes;
		for (let y = 0; y < args.height; y += 1) {
			for (let x = 0; x < args.width; x += 1) {
				const offset = base + (y * args.width + x) * 3;
				out[offset] = (x + i) % 256;
				out[offset + 1] = (y + i * 2) % 256;
				out[offset + 2] = (x + y + i) % 256;
			}
		}
	}
	return out;
}

/** Hand-rolled 44.1 kHz stereo 16-bit PCM WAV, two detuned sines. */
function makeWav(args: { seconds: number }): ArrayBuffer {
	const sampleRate = 44100;
	const totalSamples = Math.floor(args.seconds * sampleRate);
	const dataBytes = totalSamples * 2 * 2;
	const buffer = new ArrayBuffer(44 + dataBytes);
	const view = new DataView(buffer);
	const ascii = (offset: number, text: string): void => {
		for (let i = 0; i < text.length; i += 1) {
			view.setUint8(offset + i, text.charCodeAt(i));
		}
	};
	ascii(0, "RIFF");
	view.setUint32(4, 36 + dataBytes, true);
	ascii(8, "WAVE");
	ascii(12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 2, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 4, true);
	view.setUint16(32, 4, true);
	view.setUint16(34, 16, true);
	ascii(36, "data");
	view.setUint32(40, dataBytes, true);
	let offset = 44;
	for (let i = 0; i < totalSamples; i += 1) {
		const t = i / sampleRate;
		view.setInt16(offset, Math.round(Math.sin(2 * Math.PI * 440 * t) * 0.3 * 32767), true);
		offset += 2;
		view.setInt16(offset, Math.round(Math.sin(2 * Math.PI * 443 * t) * 0.3 * 32767), true);
		offset += 2;
	}
	return buffer;
}

// -- ffprobe ----------------------------------------------------------------

interface ProbeStream {
	codec_type?: string;
	codec_name?: string;
	width?: number;
	height?: number;
	nb_read_frames?: string;
}

interface ProbeResult {
	streams?: ProbeStream[];
	format?: { duration?: string };
}

function ffprobeJson(args: { target: string; countFrames?: boolean }): ProbeResult {
	const argv = [FFPROBE, "-v", "error"];
	if (args.countFrames === true) argv.push("-count_frames");
	argv.push("-show_streams", "-show_format", "-of", "json", args.target);
	const result = Bun.spawnSync(argv);
	if (result.exitCode !== 0) {
		throw new Error(`ffprobe failed (${String(result.exitCode)}): ${result.stderr.toString()}`);
	}
	return JSON.parse(result.stdout.toString()) as ProbeResult;
}

function outputPathOf(root: string, descriptor: string): string {
	if (!descriptor.startsWith("file:")) {
		throw new Error(`unexpected descriptor ${descriptor}`);
	}
	return join(root, descriptor.slice("file:".length));
}

function request(projectId: string): ExportJobRequest {
	return { projectId, format: "mp4", quality: "medium", includeAudio: true };
}

function feed(
	manager: ExportJobManager,
	args: {
		jobId: string;
		frames: Uint8Array;
		from: number;
		to: number;
		batchSize: number;
		width: number;
		height: number;
	},
): void {
	const frameBytes = args.width * args.height * 3;
	const frameCount = args.to - args.from;
	for (let offset = 0; offset < frameCount; offset += args.batchSize) {
		const count = Math.min(args.batchSize, frameCount - offset);
		const startByte = (args.from + offset) * frameBytes;
		const endByte = (args.from + offset + count) * frameBytes;
		manager.acceptFrames({
			jobId: args.jobId,
			startIndex: args.from + offset,
			buffer: args.frames.subarray(startByte, endByte),
		});
	}
}

// -- tests ------------------------------------------------------------------

test(
	"happy path: 60 gradient frames + WAV → one ffmpeg encode → completed mp4 with both streams",
	async () => {
		const root = freshRoot();
		const manager = newManager(root);
		const req = request("proj-happy");
		const { jobId } = manager.startJob({
			request: req,
			projectName: "Happy Path",
			projectContentDigest: "digest-fixed-value",
		});
		const events: ExportJobEvent[] = [];
		manager.subscribe({ jobId, handler: (event) => events.push(event) });

		const assignment = manager.beginExport({
			jobId,
			request: req,
			renderSpec: SPEC_180,
			projectContentDigest: "digest-fixed-value",
		});
		expect(assignment.nextNeededFrame).toBe(0);
		expect(assignment.width).toBe(320);
		expect(assignment.height).toBe(180);
		expect(assignment.fps).toEqual({ numerator: 30, denominator: 1 });
		expect(assignment.totalFrames).toBe(60);

		const frames = makeFrames({ count: 60, width: 320, height: 180 });
		feed(manager, {
			jobId,
			frames,
			from: 0,
			to: 60,
			batchSize: 10,
			width: 320,
			height: 180,
		});

		manager.acceptAudio({ jobId, wav: makeWav({ seconds: 2 }) });
		manager.finalize({ jobId });
		const settled = await manager.whenSettled({ jobId });

		expect(settled.phase).toBe("completed");
		expect(settled.error).toBeNull();
		expect(settled.frames).toEqual({ accepted: 60, total: 60 });
		expect(settled.output?.bytes ?? 0).toBeGreaterThan(1000);

		// The output name is the sanitized project + job prefix, and no path
		// crossed: the descriptor is `file:<relative name>`.
		expect(settled.output?.descriptor.startsWith("file:Happy-Path-")).toBe(true);
		const output = outputPathOf(root, settled.output?.descriptor ?? "");
		expect(existsSync(output)).toBe(true);
		const bytes = manager.readJobOutputBytes({ jobId });
		expect(bytes.byteLength).toBe(settled.output?.bytes ?? -1);

		// Record kept, transient stream cleaned.
		expect(existsSync(join(root, "jobs", `${jobId}.json`))).toBe(true);
		expect(existsSync(join(root, "jobs", `${jobId}.raw`))).toBe(false);
		expect(existsSync(join(root, "jobs", `${jobId}.audio.wav`))).toBe(false);

		// Progress: rendering phase reported inside (0,1) monotonically, and
		// the encode phase reported at least once (frame-carrying events are
		// rendering; frameless ones are encoding).
		const rendering = events
			.filter((event) => event.type === "progress" && event.frames !== undefined)
			.map((event) => (event as { progress: number }).progress);
		expect(rendering.some((value) => value > 0 && value < 1)).toBe(true);
		for (let i = 1; i < rendering.length; i += 1) {
			expect(rendering[i]).toBeGreaterThanOrEqual(rendering[i - 1]);
		}
		const encoding = events
			.filter((event) => event.type === "progress" && event.frames === undefined)
			.map((event) => (event as { progress: number }).progress);
		expect(encoding.length).toBeGreaterThan(0);
		for (let i = 1; i < encoding.length; i += 1) {
			expect(encoding[i]).toBeGreaterThanOrEqual(encoding[i - 1]);
		}

		// ffprobe: one video (320x180, h264) + one audio (aac), duration ≈ 2 s.
		const probe = ffprobeJson({ target: output });
		const video = probe.streams?.find((stream) => stream.codec_type === "video");
		const audio = probe.streams?.find((stream) => stream.codec_type === "audio");
		expect(video?.codec_name).toBe("h264");
		expect(video?.width).toBe(320);
		expect(video?.height).toBe(180);
		expect(audio?.codec_name).toBe("aac");
		const duration = Number(probe.format?.duration ?? "0");
		expect(Math.abs(duration - 2.0)).toBeLessThan(0.2);
	},
	60000,
);

test(
	"cancel mid-render: settles cancelled, keeps the record, deletes raw/wav/partial",
	async () => {
		const root = freshRoot();
		const manager = newManager(root);
		const req = request("proj-cancel-render");
		const { jobId } = manager.startJob({ request: req, projectName: "Cancel Render" });
		manager.beginExport({ jobId, request: req, renderSpec: SPEC_180 });
		const frames = makeFrames({ count: 10, width: 320, height: 180 });
		manager.acceptFrames({ jobId, startIndex: 0, buffer: frames });

		const cancelled = await manager.cancelJob({ jobId });
		expect(cancelled.phase).toBe("cancelled");
		expect(cancelled.frames).toEqual({ accepted: 10, total: 60 });

		// No producer ran, so no child ever existed — the artifacts are the
		// assertion surface: stream gone, wav gone, no partial, no output.
		expect(existsSync(join(root, "jobs", `${jobId}.raw`))).toBe(false);
		expect(existsSync(join(root, "jobs", `${jobId}.audio.wav`))).toBe(false);
		const record = JSON.parse(
			readFileSync(join(root, "jobs", `${jobId}.json`), "utf8"),
		) as { outputName: string };
		expect(existsSync(join(root, record.outputName))).toBe(false);
		expect(existsSync(`${join(root, record.outputName)}.partial`)).toBe(false);
		expect(readdirSync(root).filter((name) => name.endsWith(".partial"))).toEqual([]);

		// The record is kept — the history is listable.
		expect(manager.listJobs().map((job) => job.phase)).toEqual(["cancelled"]);
		// And cancelling again is idempotent by contract.
		const again = await manager.cancelJob({ jobId });
		expect(again.phase).toBe("cancelled");
	},
	30000,
);

test(
	"cancel mid-encode: the resolved cancel proves the child exited; partial and raw are gone",
	async () => {
		const root = freshRoot();
		const manager = newManager(root);
		const req = request("proj-cancel-encode");
		const { jobId } = manager.startJob({ request: req, projectName: "Cancel Encode" });
		manager.beginExport({ jobId, request: req, renderSpec: SPEC_360 });
		const frames = makeFrames({ count: 240, width: 640, height: 360 });
		feed(manager, {
			jobId,
			frames,
			from: 0,
			to: 240,
			batchSize: 20,
			width: 640,
			height: 360,
		});
		manager.acceptAudio({ jobId, wav: makeWav({ seconds: 8 }) });
		manager.finalize({ jobId });

		// Wait until the encode is actually running, then cancel inside it.
		const deadline = Date.now() + 15000;
		while (manager.getJob({ jobId })?.phase !== "encoding") {
			if (Date.now() > deadline) throw new Error("encode never started");
			await Bun.sleep(25);
		}
		const cancelled = await manager.cancelJob({ jobId });
		expect(cancelled.phase).toBe("cancelled");
		// cancelJob resolves only after the child's exit gate released (the
		// SIGTERM→SIGKILL await chain) — a resolved cancel IS the exit proof.
		expect(existsSync(join(root, "jobs", `${jobId}.raw`))).toBe(false);
		expect(readdirSync(root).filter((name) => name.endsWith(".partial"))).toEqual([]);
		const finalSnapshot = manager.getJob({ jobId });
		expect(finalSnapshot?.output).toBeNull();
	},
	120000,
);

test(
	"interrupt + resume across manager instances completes with the exact frame count",
	async () => {
		const root = freshRoot();
		const manager1 = newManager(root);
		const req = request("proj-resume");
		const { jobId } = manager1.startJob({ request: req, projectName: "Resume Case" });
		manager1.beginExport({ jobId, request: req, renderSpec: SPEC_180 });
		const frames = makeFrames({ count: 60, width: 320, height: 180 });
		feed(manager1, {
			jobId,
			frames,
			from: 0,
			to: 25,
			batchSize: 5,
			width: 320,
			height: 180,
		});

		const interruptedCount = manager1.interruptAllLive();
		expect(interruptedCount).toBe(1);
		const atRest = manager1.listJobs();
		expect(atRest[0]?.phase).toBe("interrupted");
		expect(atRest[0]?.frames).toEqual({ accepted: 25, total: 60 });
		await manager1.dispose();

		// A NEW manager over the same root is the restarted process.
		const manager2 = newManager(root);
		const listed = manager2.listJobs();
		expect(listed).toHaveLength(1);
		expect(listed[0]?.phase).toBe("interrupted");
		expect(listed[0]?.frames).toEqual({ accepted: 25, total: 60 });

		const assignment = manager2.resumeJob({ jobId: listed[0]?.jobId ?? "" });
		expect(assignment.nextNeededFrame).toBe(25);
		expect(assignment.totalFrames).toBe(60);

		feed(manager2, {
			jobId,
			frames,
			from: 25,
			to: 60,
			batchSize: 5,
			width: 320,
			height: 180,
		});
		manager2.acceptAudio({ jobId, wav: makeWav({ seconds: 2 }) });
		manager2.finalize({ jobId });
		const settled = await manager2.whenSettled({ jobId });
		expect(settled.phase).toBe("completed");
		expect(settled.frames).toEqual({ accepted: 60, total: 60 });

		// The resumed encode consumed 25 + 35 frames: the file reports the
		// full 60 (± container rounding), duration ≈ the happy path's 2 s.
		const output = outputPathOf(root, settled.output?.descriptor ?? "");
		const probe = ffprobeJson({ target: output, countFrames: true });
		const video = probe.streams?.find((stream) => stream.codec_type === "video");
		const frameCount = Number(video?.nb_read_frames ?? "0");
		expect(frameCount).toBeGreaterThanOrEqual(58);
		expect(frameCount).toBeLessThanOrEqual(62);
		const duration = Number(probe.format?.duration ?? "0");
		expect(Math.abs(duration - 2.0)).toBeLessThan(0.25);
	},
	90000,
);

test(
	"the boot scan interrupts a record left rendering at rest, and discard removes everything",
	async () => {
		const root = freshRoot();
		const manager1 = newManager(root);
		const req = request("proj-bootscan");
		const { jobId } = manager1.startJob({ request: req, projectName: "Boot Scan" });
		manager1.beginExport({ jobId, request: req, renderSpec: SPEC_180 });
		const frames = makeFrames({ count: 10, width: 320, height: 180 });
		feed(manager1, {
			jobId,
			frames,
			from: 0,
			to: 10,
			batchSize: 5,
			width: 320,
			height: 180,
		});
		// dispose WITHOUT interrupting: the record is left `rendering` at
		// rest, exactly as a process death would leave it.
		await manager1.dispose();
		expect(
			JSON.parse(readFileSync(join(root, "jobs", `${jobId}.json`), "utf8") as string).phase,
		).toBe("rendering");

		const manager2 = newManager(root);
		const interrupted = manager2.interruptAllLive();
		expect(interrupted).toBe(1);
		const job = manager2.getJob({ jobId });
		expect(job?.phase).toBe("interrupted");
		expect(job?.frames).toEqual({ accepted: 10, total: 60 });
		// A second scan is a no-op: the record is no longer live.
		expect(manager2.interruptAllLive()).toBe(0);

		manager2.discardJob({ jobId });
		expect(manager2.listJobs()).toEqual([]);
		expect(existsSync(join(root, "jobs", `${jobId}.json`))).toBe(false);
		expect(existsSync(join(root, "jobs", `${jobId}.raw`))).toBe(false);
	},
	30000,
);

test("a frame gap or duplicate fails the job with the named desync reason", () => {
	const root = freshRoot();
	const manager = newManager(root);

	// Gap: the first batch declares startIndex 3 for a 0-frame record.
	const gapReq = request("proj-gap");
	const { jobId: gapJob } = manager.startJob({ request: gapReq, projectName: "Gap" });
	manager.beginExport({ jobId: gapJob, request: gapReq, renderSpec: SPEC_180 });
	const frames = makeFrames({ count: 10, width: 320, height: 180 });
	expect(() =>
		manager.acceptFrames({ jobId: gapJob, startIndex: 3, buffer: frames }),
	).toThrow(ExportJobManagerError);
	const gapJobSnapshot = manager.getJob({ jobId: gapJob });
	expect(gapJobSnapshot?.phase).toBe("failed");
	expect(gapJobSnapshot?.error).toContain(FRAME_STREAM_DESYNC_REASON);

	// Duplicate: frame 0 accepted twice — the second batch is a duplicate.
	const dupReq = request("proj-duplicate");
	const { jobId: dupJob } = manager.startJob({ request: dupReq, projectName: "Dup" });
	manager.beginExport({ jobId: dupJob, request: dupReq, renderSpec: SPEC_180 });
	manager.acceptFrames({ jobId: dupJob, startIndex: 0, buffer: frames });
	expect(() =>
		manager.acceptFrames({ jobId: dupJob, startIndex: 0, buffer: frames }),
	).toThrow(ExportJobManagerError);
	const dupSnapshot = manager.getJob({ jobId: dupJob });
	expect(dupSnapshot?.phase).toBe("failed");
	expect(dupSnapshot?.error).toContain(FRAME_STREAM_DESYNC_REASON);

	// A failed job keeps its record for the list, and re-attaching refuses.
	expect(manager.listJobs().every((job) => job.phase === "failed")).toBe(true);
	expect(() =>
		manager.beginExport({ jobId: dupJob, request: dupReq, renderSpec: SPEC_180 }),
	).toThrow(/already settled/);
});

// -- M-1 regression: the raw stream must agree with the record on attach ------

test(
	"resume truncates a garbage tail (file ahead of the record) and still completes exactly",
	async () => {
		const root = freshRoot();
		const manager1 = newManager(root);
		const req = request("proj-surplus");
		const { jobId } = manager1.startJob({ request: req, projectName: "Surplus Tail" });
		manager1.beginExport({ jobId, request: req, renderSpec: SPEC_180 });
		const frames = makeFrames({ count: 60, width: 320, height: 180 });
		feed(manager1, {
			jobId,
			frames,
			from: 0,
			to: 25,
			batchSize: 5,
			width: 320,
			height: 180,
		});
		const frameBytes = 320 * 180 * 3;
		const rawPath = join(root, "jobs", `${jobId}.raw`);
		// The dead-producer signature (M-1 path a/c): five frames were
		// appended but their store transition/persist never landed — the file
		// is ahead of the record by whole frames.
		appendFileSync(rawPath, frames.subarray(25 * frameBytes, 30 * frameBytes));
		expect(statSync(rawPath).size).toBe(30 * frameBytes);

		const interrupted = manager1.interruptAllLive();
		expect(interrupted).toBe(1);
		await manager1.dispose();

		const manager2 = newManager(root);
		// The record still says 25 — and the resume must TRUNCATE the file to
		// exactly that before any producer attaches.
		const assignment = manager2.resumeJob({ jobId });
		expect(assignment.nextNeededFrame).toBe(25);
		expect(statSync(rawPath).size).toBe(25 * frameBytes);

		feed(manager2, {
			jobId,
			frames,
			from: 25,
			to: 60,
			batchSize: 5,
			width: 320,
			height: 180,
		});
		manager2.acceptAudio({ jobId, wav: makeWav({ seconds: 2 }) });
		manager2.finalize({ jobId });
		const settled = await manager2.whenSettled({ jobId });
		expect(settled.phase).toBe("completed");
		// Without the truncation FFmpeg would read 65 frames; the tightened
		// bounds (60 ± 2) are exactly what a silent-tail bug would break.
		const output = outputPathOf(root, settled.output?.descriptor ?? "");
		const probe = ffprobeJson({ target: output, countFrames: true });
		const video = probe.streams?.find((stream) => stream.codec_type === "video");
		const frameCount = Number(video?.nb_read_frames ?? "0");
		expect(frameCount).toBeGreaterThanOrEqual(58);
		expect(frameCount).toBeLessThanOrEqual(62);
		const duration = Number(probe.format?.duration ?? "0");
		expect(Math.abs(duration - 2.0)).toBeLessThan(0.25);
	},
	90000,
);

test(
	"resume over a short raw stream fails with the named reason instead of guessing",
	async () => {
		const root = freshRoot();
		const manager1 = newManager(root);
		const req = request("proj-short");
		const { jobId } = manager1.startJob({ request: req, projectName: "Short Stream" });
		manager1.beginExport({ jobId, request: req, renderSpec: SPEC_180 });
		const frames = makeFrames({ count: 25, width: 320, height: 180 });
		feed(manager1, {
			jobId,
			frames,
			from: 0,
			to: 25,
			batchSize: 5,
			width: 320,
			height: 180,
		});
		// Fabricate the shortage (M-1 path b's disk-side residue): the record
		// claims 25 accepted frames, the stream holds only 20 frames' bytes.
		const frameBytes = 320 * 180 * 3;
		const rawPath = join(root, "jobs", `${jobId}.raw`);
		truncateSync(rawPath, 20 * frameBytes);

		expect(manager1.interruptAllLive()).toBe(1);
		await manager1.dispose();

		const manager2 = newManager(root);
		expect(() => manager2.resumeJob({ jobId })).toThrow(RAW_STREAM_SHORT_REASON);
		// The job settled failed with the named reason; the dishonest stream
		// is gone (a failed job cleans its artifacts).
		const snapshot = manager2.getJob({ jobId });
		expect(snapshot?.phase).toBe("failed");
		expect(snapshot?.error).toContain(RAW_STREAM_SHORT_REASON);
		expect(existsSync(rawPath)).toBe(false);
	},
	30000,
);
