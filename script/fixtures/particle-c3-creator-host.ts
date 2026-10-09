import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { InMemoryProjectStore } from "../../packages/editor-ports/src/in-memory";
import { compileProgrammaticProject } from "../../apps/cli/src/programmatic/engines/compile-project";
import { renderHtmlPng } from "../../apps/cli/src/programmatic/html-rasterizer";
import {
	describeResource,
	saveResourceBytes,
} from "../../apps/cli/src/programmatic/resource-bytes";
import type { ProgrammaticSource } from "../../packages/editor-contracts/src/programmatic";
import { threeModel } from "./three-assets";

const processes: { closed: boolean }[] = (globalThis as any)
	.__particleC2Processes;
const [root, toolchainDirectory, executable, ffmpeg] = process.argv.slice(2);
const context = {
	projectId: "particle-creator-model",
	store: new InMemoryProjectStore(),
};
const signal = AbortSignal.timeout(180000);
const hash = (bytes: Uint8Array | string) =>
	createHash("sha256").update(bytes).digest("hex");
const checks: unknown[] = [];
const allClosed = () =>
	assert.ok(processes?.length && processes.every((p) => p.closed));
const capture = (source: ProgrammaticSource, index: number) =>
	renderHtmlPng({
		executable,
		resourceStore: context,
		signal,
		request: {
			source,
			clipStart: 0,
			clipDuration: 484000,
			trimStart: 0,
			timelineTime: index * 4000,
		},
	});
async function visiblePixels(path: string) {
	const bytes = await new Promise<Buffer>((done, reject) => {
		const child = spawn(
			ffmpeg,
			[
				"-v",
				"error",
				"-i",
				path,
				"-f",
				"rawvideo",
				"-pix_fmt",
				"rgba",
				"pipe:1",
			],
			{
				windowsHide: true,
				stdio: ["ignore", "pipe", "pipe"],
				signal,
			},
		);
		const chunks: Buffer[] = [],
			errors: Buffer[] = [];
		child.stdout.on("data", (b) => chunks.push(b));
		child.stderr.on("data", (b) => errors.push(b));
		child.once("error", reject);
		child.once("close", (code) =>
			code === 0
				? done(Buffer.concat(chunks))
				: reject(Error(Buffer.concat(errors).toString("utf8"))),
		);
	});
	assert.equal(bytes.length, 320 * 240 * 4);
	let active = 0,
		red = 0,
		green = 0,
		blue = 0;
	for (let i = 0; i < bytes.length; i += 4)
		if (bytes[i + 3] > 200) {
			active++;
			if (bytes[i] > 200 && bytes[i + 1] < 70) red++;
			if (bytes[i + 1] > 200 && bytes[i] < 70) green++;
			if (bytes[i + 2] > 200 && bytes[i] < 70) blue++;
		}
	assert.ok(
		active > 1000 && red > 200 && green > 200 && blue > 200,
		`Expected textured GLB points, got ${JSON.stringify({ active, red, green, blue })}`,
	);
	return { active, red, green, blue };
}
try {
	assert.equal(process.versions.bun, "1.2.18");
	const { particleThree } = await import(
		pathToFileURL(join(root, "particle-object.mjs")).href
	);
	const model = threeModel();
	const resource = describeResource(
		{ id: "test-model", kind: "model", mimeType: "model/gltf-binary" },
		model.length,
		hash(model),
	);
	await saveResourceBytes(
		context,
		{ resource, body: new Uint8Array(model).buffer },
		signal,
	);
	const shot = particleThree({
		sourceDirectory: join(root, "author"),
		model: resource,
		settings: { width: 320, height: 240, durationFrames: 121, seed: 7391 },
		inputProps: { rotationSpeed: [0, 0, 0], motion: { driftAmplitude: 0 } },
	});
	assert.deepEqual(shot.spec.capabilities, ["particle-surface-v1"]);
	const result = await compileProgrammaticProject({
		action: "compile",
		input: shot.spec,
		toolchainDirectory,
		context,
		signal,
		enqueue: async (task) => task(),
	});
	allClosed();
	await writeFile(
		join(root, "compiled-source.json"),
		JSON.stringify(result.source, null, 2),
		{ flag: "wx" },
	);
	const frames = new Map<number, Buffer>();
	for (const index of [0, 30, 90]) {
		const png = await capture(result.source, index);
		allClosed();
		frames.set(index, png);
		const path = join(root, `model-${index}.png`);
		await writeFile(path, png, { flag: "wx" });
		const pixels = await visiblePixels(path);
		allClosed();
		checks.push({
			label: "Creator template + embedded-texture GLB + Rust + PNG",
			index,
			pngSha256: hash(png),
			pixels,
		});
	}
	assert.notEqual(hash(frames.get(0)!), hash(frames.get(30)!));
	assert.equal(hash(frames.get(0)!), hash(frames.get(90)!));
	// Only this probe's author directory is moved; no user source is touched.
	const from = resolve(root, "author"),
		to = resolve(root, "author-retained");
	assert.equal(from, resolve(root) + "\\author");
	assert.equal(to, resolve(root) + "\\author-retained");
	await rename(from, to);
	try {
		const source = JSON.parse(
			await readFile(join(root, "compiled-source.json"), "utf8"),
		);
		const rebuilt = await compileProgrammaticProject({
			action: "rebuild",
			input: source,
			toolchainDirectory,
			context,
			signal,
			enqueue: async (task) => task(),
		});
		assert.deepEqual(rebuilt.source.build, result.source.build);
		assert.equal(hash(await capture(rebuilt.source, 0)), hash(frames.get(0)!));
		allClosed();
		checks.push({
			label:
				"Archive-only rebuild and identical PNG with original author directory absent",
		});
	} finally {
		await rename(to, from);
	}
	await writeFile(
		join(root, "evidence.json"),
		JSON.stringify(
			{
				version: 1,
				scope:
					"Creator particleThree template compile/GLB/PNG/archive rebuild in memory; not durable editor/Electron/video export",
				checks,
				processes,
				templateSha256: hash(await readFile(join(root, "particle-object.mjs"))),
			},
			null,
			2,
		) + "\n",
		{ flag: "wx" },
	);
	console.log(
		JSON.stringify({
			status: "passed",
			checks: checks.length,
			children: processes.length,
		}),
	);
} catch (error) {
	await writeFile(
		join(root, "failure.json"),
		JSON.stringify(
			{
				error: String(error),
				stack: (error as Error)?.stack,
				checks,
				processes,
			},
			null,
			2,
		),
		{ flag: "wx" },
	);
	throw error;
}
