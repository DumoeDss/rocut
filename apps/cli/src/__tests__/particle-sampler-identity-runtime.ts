// Test-only explicit host inputs; production has no environment/path override.
import { pathToFileURL } from "node:url";
import { captureParticleSamplerSource } from "../programmatic/particle-sampler-identity-source";
import { completeParticleSamplerIdentity } from "../programmatic/particle-sampler-identity";
import { spawnParticleSamplerProcess } from "../programmatic/particle-sampler-worker-process";
import { bootstrapParticleSamplerProcess } from "../programmatic/particle-sampler-worker-bootstrap";
import { createParticleSamplerWorker } from "../programmatic/particle-sampler-worker";

const mode = process.argv[2];
let closed = false;
let bootstrapSourceBytes: number | undefined;
let bootstrapModuleBytes: number | undefined;
const worker = await (async () => {
	if (mode === "packed")
		return createParticleSamplerWorker({
			bootstrapTimeoutMs: 10_000,
			expectedIdentity: process.argv[5]
				? JSON.parse(process.argv[5])
				: undefined,
		});
	if (mode !== "source") throw Error("Invalid identity test mode");
	const captured = captureParticleSamplerSource({
		moduleUrl: pathToFileURL(process.argv[3]!).href,
		workerEntryUrl: pathToFileURL(process.argv[4]!).href,
		layout: "source-sync",
	});
	bootstrapSourceBytes = captured.bootstrapSourceBytes;
	bootstrapModuleBytes = captured.bootstrapModuleBytes;
	const spawned = spawnParticleSamplerProcess(
		captured.moduleUrl,
		undefined,
		captured,
	);
	spawned.child.once("close", () => {
		closed = true;
	});
	const initialized = await bootstrapParticleSamplerProcess(spawned, 10_000);
	return {
		...initialized,
		samplerIdentity: completeParticleSamplerIdentity(
			captured.identityBase,
			initialized,
		),
	};
})();
let samples = 0;
try {
	await worker.ready;
	const response = await worker.sampler(
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
			count: 2,
			seed: 42,
		}),
		new AbortController().signal,
	);
	samples = JSON.parse(response).samples.length;
} finally {
	await worker.terminateSampler();
	if (mode === "packed") closed = true; // factory termination requires real close
}
process.stdout.write(
	JSON.stringify({
		mode,
		closed,
		samples,
		identity: worker.samplerIdentity,
		bootstrapSourceBytes,
		bootstrapModuleBytes,
	}),
);
