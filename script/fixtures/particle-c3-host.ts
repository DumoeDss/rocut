import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { InMemoryProjectStore } from "../../packages/editor-ports/src/in-memory";
import { compileProgrammaticProject } from "../../apps/cli/src/programmatic/engines/compile-project";
import { renderHtmlPng } from "../../apps/cli/src/programmatic/html-rasterizer";
import { loadProgrammaticResource } from "../../apps/cli/src/programmatic/resources";
import { parseThreeParticleArchive } from "../../apps/cli/src/programmatic/three-particle-provenance";
import type { ProgrammaticSource } from "../../packages/editor-contracts/src/programmatic";
import { particleMaterialPixels } from "./particle-c3-pixels";

const processes: { pid?: number; closed: boolean }[] = (globalThis as any)
	.__particleC2Processes;
const [root, toolchainDirectory, executable, ffmpeg] = process.argv.slice(2);
const hash = (value: Uint8Array | string) =>
	createHash("sha256").update(value).digest("hex");
const context = {
	projectId: "particle-c3-material-motion",
	store: new InMemoryProjectStore(),
};
const signal = AbortSignal.timeout(180_000);
const checks: unknown[] = [];
const allClosed = () => {
	assert.ok(processes?.length > 0, "Private process observation required");
	assert.ok(
		processes.every((p) => p.closed),
		"Capture returned before direct child close",
	);
};
const compile = (mode: string) =>
	compileProgrammaticProject({
		action: "compile",
		input: {
			version: 1,
			engine: "three",
			sourceDirectory: join(root, "author"),
			entryFile: "index.ts",
			files: ["index.ts", "material-checks.js"],
			width: 320,
			height: 240,
			frameRate: { numerator: 25, denominator: 1 },
			durationFrames: 101,
			seed: 7391,
			inputProps: { mode },
			capabilities: ["particle-surface-v1"],
		},
		toolchainDirectory,
		context,
		signal,
		enqueue: async (task) => task(),
	});
const capture = (source: ProgrammaticSource, index: number) =>
	renderHtmlPng({
		executable,
		resourceStore: context,
		signal,
		request: {
			source,
			clipStart: 0,
			clipDuration: 484800,
			trimStart: 0,
			timelineTime: index * 4800,
		},
	});
function causes(error: unknown): string {
	if (!(error instanceof Error)) return String(error);
	return [
		error.message,
		error.cause ? causes(error.cause) : "",
		...(error instanceof AggregateError ? error.errors.map(causes) : []),
	]
		.filter(Boolean)
		.join(" | ");
}
try {
	assert.equal(process.versions.bun, "1.2.18");
	const compiled = await compile("success");
	allClosed();
	const archive = await loadProgrammaticResource({
		...context,
		resource: compiled.source.build!.toolchainLock,
		signal,
	});
	const identity = parseThreeParticleArchive(compiled.source, archive.body)!;
	assert.equal(
		identity.samplerIdentity.files.find((e) => e.role === "wasm")?.sha256,
		hash(await readFile(join(root, "opencut_wasm_bg.wasm"))),
	);
	const rebuilt = await compileProgrammaticProject({
		action: "rebuild",
		input: compiled.source,
		toolchainDirectory,
		context,
		signal,
		enqueue: async (task) => task(),
	});
	assert.equal(rebuilt.source.code, compiled.source.code);
	assert.deepEqual(rebuilt.source.build, compiled.source.build);
	allClosed();
	checks.push({
		label:
			"Real compile/archive/rebuild binds current sampler and material/motion adapter",
		status: "passed",
		identity,
	});
	const frames = new Map<number, Buffer>();
	const pixels = new Map<
		number,
		Awaited<ReturnType<typeof particleMaterialPixels>>
	>();
	// Nonmonotonic order is deliberate: every frame is independent of capture history.
	for (const [index, name] of [
		[0, "rest"],
		[25, "scatter"],
		[0, "rest-seek"],
		[75, "return"],
		[12, "middle"],
		[12, "middle-duplicate"],
	] as const) {
		const png = await capture(compiled.source, index);
		allClosed();
		const existing = frames.get(index);
		if (existing)
			assert.equal(
				hash(png),
				hash(existing),
				"Same integer frame must be byte-identical",
			);
		frames.set(index, png);
		const file = join(root, name + ".png");
		await writeFile(file, png, { flag: "wx" });
		const result = await particleMaterialPixels(ffmpeg, file);
		allClosed();
		pixels.set(index, result);
		checks.push({
			label: name,
			status: "passed",
			index,
			pngSha256: hash(png),
			pixels: result,
		});
	}
	assert.equal(
		hash(frames.get(0)!),
		hash(frames.get(75)!),
		"Zero-drift return must reproduce the rest image",
	);
	assert.ok(
		pixels.get(25)!.varianceX > pixels.get(0)!.varianceX * 1.4,
		"Scatter must visibly expand the point distribution",
	);
	assert.notEqual(hash(frames.get(12)!), hash(frames.get(0)!));
	checks.push({
		label: "Visible scatter, exact return and out-of-order repeatability",
		status: "passed",
		varianceRatio: pixels.get(25)!.varianceX / pixels.get(0)!.varianceX,
	});
	const browserTextures = await compile("browser-textures");
	assert.equal(
		hash(await capture(browserTextures.source, 0)),
		hash(frames.get(0)!),
	);
	allClosed();
	checks.push({
		label:
			"Real image/canvas/offscreen/ImageBitmap color/alpha readback and budget rejection",
		status: "passed",
		minimumBrowserAssertions: 70,
	});
	for (const [mode, expected] of [
		["unsupported-uv", /UV|channel/],
		["rust-motion-error", /motion.scatterDistance|scatterDistance/],
	] as const) {
		const invalid = await compile(mode);
		let failure = "";
		try {
			await capture(invalid.source, 0);
		} catch (error) {
			failure = causes(error);
		}
		assert.match(failure, expected);
		allClosed();
		checks.push({ label: mode + " rejects PNG", status: "passed", failure });
	}
	await writeFile(
		join(root, "evidence.json"),
		JSON.stringify(
			{
				version: 1,
				scope:
					"C3 DataTexture base color + real Rust motion + Chromium points; not editor/Electron/product parity",
				runtime: { bun: process.versions.bun, executable: process.execPath },
				checks,
				processes,
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
		JSON.stringify({ error: causes(error), checks, processes }, null, 2) + "\n",
		{ flag: "wx" },
	);
	throw error;
}
