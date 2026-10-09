import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { InMemoryProjectStore } from "../../packages/editor-ports/src/in-memory";
import { compileProgrammaticProject } from "../../apps/cli/src/programmatic/engines/compile-project";
import { withBuildResources } from "../../apps/cli/src/programmatic/engines/build-source";
import { renderHtmlPng } from "../../apps/cli/src/programmatic/html-rasterizer";
import {
	describeResource,
	saveResourceBytes,
} from "../../apps/cli/src/programmatic/resource-bytes";
import {
	loadProgrammaticResource,
	resourceDigest,
} from "../../apps/cli/src/programmatic/resources";
import {
	parseThreeParticleArchive,
	threeParticleCompileIdentity,
} from "../../apps/cli/src/programmatic/three-particle-provenance";
import { completeParticleSamplerIdentity } from "../../apps/cli/src/programmatic/particle-sampler-identity";
import type { ProgrammaticSource } from "../../packages/editor-contracts/src/programmatic";
import { particlePixels } from "./particle-c2-pixels";

type ProcessRecord = {
	executable: string;
	pid?: number;
	closed: boolean;
	code?: number | null;
};
const processes: ProcessRecord[] = (globalThis as any).__particleC2Processes;
const [root, toolchainDirectory, executable, ffmpeg] = process.argv.slice(2);
const hash = (value: Buffer) =>
	createHash("sha256").update(value).digest("hex");
const context = {
	projectId: "particle-c2-real-capture",
	store: new InMemoryProjectStore(),
};
const signal = AbortSignal.timeout(180_000);
const checks: unknown[] = [];
const specification = {
	version: 1,
	engine: "three",
	sourceDirectory: join(root, "author"),
	entryFile: "index.ts",
	files: ["index.ts"],
	width: 320,
	height: 240,
	frameRate: { numerator: 25, denominator: 1 },
	durationFrames: 8,
	seed: 7391,
};
const allClosed = () => {
	assert.ok(
		Array.isArray(processes) && processes.length > 0,
		"Native process observer must be active",
	);
	assert.ok(
		processes.every((entry) => entry.closed),
		"Capture returned before a private process closed",
	);
};
const compile = (mode: string, particle = true) =>
	compileProgrammaticProject({
		action: "compile",
		input: {
			...specification,
			inputProps: { mode },
			...(particle ? { capabilities: ["particle-surface-v1"] } : {}),
		},
		toolchainDirectory,
		context,
		signal,
		enqueue: async (task) => task(),
	});
const request = (source: ProgrammaticSource, index = 0) => ({
	source,
	clipStart: 0,
	clipDuration: 38_400,
	trimStart: 0,
	timelineTime: index * 4800,
});
const capture = (
	source: ProgrammaticSource,
	index = 0,
	captureSignal = signal,
) =>
	renderHtmlPng({
		executable,
		request: request(source, index),
		resourceStore: context,
		signal: captureSignal,
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
async function mustFail(
	label: string,
	run: () => Promise<unknown>,
	expected: RegExp,
	noProcess = false,
) {
	const before = processes.length;
	let failure: string | undefined;
	try {
		await run();
	} catch (error) {
		failure = causes(error);
	}
	assert.ok(
		failure && expected.test(failure),
		`${label}: ${failure ?? "unexpected success"}`,
	);
	if (noProcess)
		assert.equal(
			processes.length,
			before,
			`${label}: must fail before spawning`,
		);
	allClosed();
	checks.push({
		label,
		status: "passed",
		failure,
		spawned: processes.length - before,
	});
}

try {
	assert.equal(process.versions.bun, "1.2.18");
	assert.ok(processes, "Build with the native process observation wrapper");
	const compiled = await compile("success");
	allClosed();
	const archive = await loadProgrammaticResource({
		...context,
		resource: compiled.source.build!.toolchainLock,
		signal,
	});
	const identity = parseThreeParticleArchive(compiled.source, archive.body)!;
	assert.equal(identity.samplerIdentity.runtime.version, "1.2.18");
	assert.equal(
		identity.samplerIdentity.files.find((entry) => entry.role === "wasm")
			?.sha256,
		"da14d6685fd4769c4895bbf9a673cdf8632a27e2687f313038b4543161812957",
	);
	const rebuilt = await compileProgrammaticProject({
		action: "rebuild",
		input: compiled.source,
		toolchainDirectory,
		context,
		signal,
		enqueue: async (task) => task(),
	});
	assert.deepEqual(rebuilt.source, compiled.source);
	assert.equal(rebuilt.reusedDocument, true);
	allClosed();
	checks.push({
		label: "real compile/archive/rebuild",
		status: "passed",
		identity,
	});
	const outputs: {
		sha256: string;
		path: string;
		pixels: Awaited<ReturnType<typeof particlePixels>>;
	}[] = [];
	for (const [label, index] of [
		["frame-0-a", 0],
		["frame-0-b", 0],
		["frame-1", 1],
	] as const) {
		console.log(`Capturing ${label}`);
		const start = processes.length;
		const png = await capture(compiled.source, index);
		allClosed();
		assert.ok(
			processes.slice(start).some((entry) => /chrome/i.test(entry.executable)),
		);
		assert.ok(
			processes.slice(start).some((entry) => /bun/i.test(entry.executable)),
		);
		const path = join(root, `${label}.png`);
		await writeFile(path, png, { flag: "wx" });
		const pixels = await particlePixels(ffmpeg, path);
		outputs.push({ sha256: hash(png), path, pixels });
	}
	assert.equal(outputs[0].sha256, outputs[1].sha256);
	assert.notEqual(outputs[0].sha256, outputs[2].sha256);
	assert.ok(outputs[2].pixels.centroidX - outputs[0].pixels.centroidX > 100);
	checks.push({
		label: "real Three/Rust particle PNG and pose ordering",
		status: "passed",
		outputs,
	});
	const ordinary = await compile("success", false);
	const ordinaryLock = await loadProgrammaticResource({
		...context,
		resource: ordinary.source.build!.toolchainLock,
		signal,
	});
	assert.equal(
		ordinaryLock.resource.sha256,
		"ff9f2aae7ecc06a8ffa1924758cc6deaab58b38ddde1168acf5a4c098c91b246",
	);
	const beforeOrdinary = processes.length;
	await capture(ordinary.source);
	allClosed();
	assert.ok(
		!processes
			.slice(beforeOrdinary)
			.some((entry) => /bun/i.test(entry.executable)),
	);
	checks.push({
		label: "ordinary Three capture spawns no sampler and retains C1 lock bytes",
		status: "passed",
		lockSha256: ordinaryLock.resource.sha256,
	});
	await mustFail(
		"Electron v1 rejects before transport or worker",
		() =>
			renderHtmlPng({
				connectionFile: join(root, "must-not-read-electron.json"),
				request: request(compiled.source),
				signal,
				resourceStore: context,
			}),
		/particle|Particle/,
		true,
	);
	const lock = JSON.parse(new TextDecoder().decode(archive.body));
	const stale = threeParticleCompileIdentity(
		{
			transportPolicy: identity.transportPolicy,
			policyJson: JSON.stringify(identity.transportPolicy),
			policyHash: identity.policyHash,
			publishedPolicyHash: identity.publishedPolicyHash,
			samplerIdentity: identity.samplerIdentity,
		},
		"f".repeat(64),
	);
	const body = new TextEncoder().encode(
		JSON.stringify({
			...lock,
			adapter: { ...lock.adapter, sha256: stale.adapterSha256 },
			threeParticle: stale,
		}),
	).buffer;
	const resource = describeResource(
		{
			id: archive.resource.id,
			kind: "source",
			mimeType: "application/octet-stream",
		},
		body.byteLength,
		resourceDigest(body),
	);
	await saveResourceBytes(context, { resource, body }, signal);
	const staleSource = withBuildResources(
		compiled.source,
		compiled.source.build!.inputs,
		resource,
	);
	await mustFail(
		"stale browser adapter",
		() => capture(staleSource),
		/recompile/,
		true,
	);
	const {
		identityHash: _identityHash,
		policyHash,
		publishedPolicyHash,
		...samplerBase
	} = identity.samplerIdentity;
	const staleSampler = completeParticleSamplerIdentity(
		{ ...samplerBase, runtime: { ...samplerBase.runtime, version: "1.2.17" } },
		{ policyHash, publishedPolicyHash },
	);
	const staleSamplerIdentity = threeParticleCompileIdentity(
		{
			transportPolicy: identity.transportPolicy,
			policyJson: JSON.stringify(identity.transportPolicy),
			policyHash: identity.policyHash,
			publishedPolicyHash: identity.publishedPolicyHash,
			samplerIdentity: staleSampler,
		},
		identity.adapterSha256,
	);
	const samplerBody = new TextEncoder().encode(
		JSON.stringify({ ...lock, threeParticle: staleSamplerIdentity }),
	).buffer;
	const samplerLock = describeResource(
		{
			id: archive.resource.id,
			kind: "source",
			mimeType: "application/octet-stream",
		},
		samplerBody.byteLength,
		resourceDigest(samplerBody),
	);
	await saveResourceBytes(
		context,
		{ resource: samplerLock, body: samplerBody },
		signal,
	);
	const samplerStart = processes.length;
	await mustFail(
		"stale sampler runtime before worker spawn",
		() =>
			capture(
				withBuildResources(
					compiled.source,
					compiled.source.build!.inputs,
					samplerLock,
				),
			),
		/sampler identity changed.*recompile/i,
	);
	assert.ok(
		!processes
			.slice(samplerStart)
			.some((entry) => /bun/i.test(entry.executable)),
	);
	for (const mode of ["cancel", "worker-crash"] as const) {
		const cancellation = new AbortController();
		let injected = false;
		(globalThis as any).__particleC2Fault = (child: { kill(): boolean }) => {
			injected = true;
			if (mode === "cancel")
				cancellation.abort(Error("C2 sampling cancellation sentinel"));
			else
				assert.equal(
					child.kill(),
					true,
					"Private sampler crash signal must be accepted",
				);
		};
		try {
			await mustFail(
				`real sampling dispatch ${mode}`,
				() =>
					capture(
						compiled.source,
						0,
						AbortSignal.any([signal, cancellation.signal]),
					),
				mode === "cancel"
					? /cancel|abort/i
					: /exited|closed|dispatch failed|worker failed/i,
			);
			assert.equal(injected, true);
		} finally {
			(globalThis as any).__particleC2Fault = undefined;
		}
	}
	for (const [mode, expected] of [
		["forgot-await", /pending|complete|await|settled/i],
		["geometry-error", /dynamic|unsupported/i],
		["rust-error", /Rust particle surface|sampling failed/i],
		["cleanup-error", /C2 author cleanup sentinel/],
	] as const) {
		const source = (await compile(mode)).source;
		await mustFail(mode, () => capture(source), expected);
	}
	allClosed();
	await writeFile(
		join(root, "evidence.json"),
		JSON.stringify(
			{
				status: "passed",
				runtime: { bun: process.versions.bun, executable: process.execPath },
				checks,
				processes,
				boundaries: [
					"Private Chromium and actual Rust sampler; no shared app attached",
					"Native spawn observer records real close events without replacing implementations",
					"Negative sampling-dispatch tests explicitly abort the private capture or kill only its own sampler before forwarding the real IPC request",
					"No material texture evaluation, animation integration, installed plugin or Electron particle rendering claimed",
				],
			},
			null,
			2,
		) + "\n",
		{ flag: "wx" },
	);
	console.log(
		JSON.stringify({ status: "passed", root, checks: checks.length }),
	);
} catch (error) {
	await writeFile(
		join(root, "failed-evidence.json"),
		JSON.stringify(
			{ status: "failed", error: causes(error), checks, processes },
			null,
			2,
		) + "\n",
		{ flag: "wx" },
	);
	throw error;
}
