import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { captureParticleSamplerSource } from "../../apps/cli/src/programmatic/particle-sampler-identity-source";
import { spawnParticleSamplerProcess } from "../../apps/cli/src/programmatic/particle-sampler-worker-process";
import { bootstrapParticleSamplerProcess } from "../../apps/cli/src/programmatic/particle-sampler-worker-bootstrap";
import { completeParticleSamplerIdentity } from "../../apps/cli/src/programmatic/particle-sampler-identity";
import { createParticleSamplerWorker } from "../../apps/cli/src/programmatic/particle-sampler-worker";
import { getThreeParticleAdapterHash } from "../../apps/cli/src/programmatic/three-particle-adapter";

const [layout, syncEntry, mode = "discover", expectedPath = ""] =
	process.argv.slice(2);
assert.ok(["packed-sidecar", "source-sync"].includes(layout));
assert.ok(["discover", "tampered-wasm"].includes(mode));
const root = dirname(fileURLToPath(import.meta.url));
const records = Reflect.get(globalThis, "__particleC2Processes");
assert.ok(Array.isArray(records));
const hash = (bytes: Uint8Array | string) =>
	createHash("sha256").update(bytes).digest("hex");
const signal = AbortSignal.timeout(15000);
async function factory(expectedIdentity?: unknown) {
	if (layout === "packed-sidecar")
		return createParticleSamplerWorker({
			bootstrapTimeoutMs: 5000,
			signal,
			expectedIdentity,
		});
	assert.equal(expectedIdentity, undefined);
	const captured = captureParticleSamplerSource({
		moduleUrl: pathToFileURL(syncEntry).href,
		workerEntryUrl: pathToFileURL(
			join(root, "particle-sampler-worker-entry.mjs"),
		).href,
		layout: "source-sync",
	});
	const worker = await bootstrapParticleSamplerProcess(
		spawnParticleSamplerProcess(captured.moduleUrl, undefined, captured),
		5000,
		undefined,
		signal,
	);
	return {
		...worker,
		samplerIdentity: completeParticleSamplerIdentity(
			captured.identityBase,
			worker,
		),
	};
}
if (mode === "tampered-wasm") {
	assert.equal(layout, "packed-sidecar");
	const expected = JSON.parse(await readFile(expectedPath, "utf8"));
	await assert.rejects(factory(expected.samplerIdentity), /identity changed/);
	assert.equal(records.length, 0);
	await writeFile(
		join(
			root,
			"tampered-wasm-" + (process.versions.bun ? "bun" : "node") + ".json",
		),
		JSON.stringify(
			{
				status: "rejected",
				reason: "actual bytes differ from prior discovery identity",
				workerStarted: false,
				selfApproved: false,
			},
			null,
			2,
		) + "\n",
		{ flag: "wx" },
	);
} else {
	let worker: Awaited<ReturnType<typeof factory>> | undefined;
	let samplerIdentity, policyJson, publishedPolicyJson;
	const negatives = [];
	try {
		worker = await factory();
		await worker.ready;
		worker.check();
		samplerIdentity = worker.samplerIdentity;
		policyJson = worker.policyJson;
		publishedPolicyJson = worker.publishedPolicyJson;
		assert.equal(
			samplerIdentity.files.find((file: any) => file.role === "wasm")!.sha256,
			"084cf7310df5bfdc1b8e4ce3f64bcff842e1b23b9fd0ca57c1c7dcffc0d1fc12",
		);
		const request = JSON.stringify({
			triangles: [
				{
					position: [
						[0, 0, 0],
						[1, 0, 0],
						[0, 1, 0],
					],
					primitiveIndex: 7,
				},
			],
			count: 2,
			seed: 42,
		});
		const response = await worker.sampler(request, signal),
			parsed = JSON.parse(response);
		assert.equal(parsed.ok, true);
		assert.equal(parsed.samples.length, 2);
		assert.equal(await worker.sampler(request, signal), response);
	} finally {
		await worker?.terminateSampler();
	}
	assert.equal(records.length, 1);
	assert.ok(records.every((entry: any) => entry.closed));
	let errorWorker: Awaited<ReturnType<typeof factory>> | undefined;
	try {
		errorWorker = await factory();
		await errorWorker.ready;
		const bad = JSON.parse(
			await errorWorker.sampler(
				JSON.stringify({
					triangles: [
						{
							position: [
								[0, 0, 0],
								[1, 0, 0],
								[0, 1, 0],
							],
							primitiveIndex: 7,
						},
					],
					count: 65537,
					seed: 42,
				}),
				signal,
			),
		);
		assert.equal(bad.ok, false);
		assert.equal(bad.error.code, "sampleCount");
		negatives.push({ case: "real Rust invalid sampleCount", rejected: true });
	} finally {
		await errorWorker?.terminateSampler();
	}
	assert.equal(records.length, 2);
	assert.ok(records.every((entry: any) => entry.closed));
	if (layout === "packed-sidecar") {
		const {
			identityHash: _ignored,
			publishedPolicyHash,
			policyHash,
			...base
		} = samplerIdentity;
		const wrongRuntime = completeParticleSamplerIdentity(
			{
				...base,
				runtime: {
					...base.runtime,
					version: base.runtime.name === "node" ? "v24.14.1" : "1.4.3",
				},
			},
			{ publishedPolicyHash, policyHash },
		);
		const count = records.length;
		await assert.rejects(factory(wrongRuntime), /identity changed/);
		assert.equal(records.length, count);
		negatives.push({
			case: "runtime identity mismatch",
			rejected: true,
			workerStarted: false,
		});
		const wrongPolicy = completeParticleSamplerIdentity(base, {
			publishedPolicyHash: hash("unapproved policy"),
			policyHash,
		});
		await assert.rejects(factory(wrongPolicy), /identity changed/);
		assert.equal(records.length, count + 1);
		assert.ok(records.every((entry: any) => entry.closed));
		negatives.push({
			case: "actual published policy differs",
			rejected: true,
			actualWorkerClosed: true,
		});
	}
	const receipt = {
		schema: "particle-worker-discovery/v1",
		status: "discovered-unapproved",
		layout,
		runtime: samplerIdentity.runtime,
		samplerIdentity,
		policyJson,
		publishedPolicyJson,
		adapterSha256: getThreeParticleAdapterHash(),
		deterministicSamples: 2,
		negatives,
		processes: records,
		allObservedDirectChildrenClosed: true,
		browserLaunched: false,
		selfApproved: false,
	};
	await writeFile(
		join(
			root,
			layout + "-" + (process.versions.bun ? "bun" : "node") + ".json",
		),
		JSON.stringify(receipt, null, 2) + "\n",
		{ flag: "wx" },
	);
}
