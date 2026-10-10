import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import {
	assertParticleSamplerIdentity,
	completeParticleSamplerIdentity,
	snapshotParticleSamplerIdentity,
} from "./particle-sampler-identity";
import { validateParticleBootstrapTimeout } from "./particle-sampler-worker-bootstrap";
import { captureLiquidObjectWorkerSource } from "./liquid-object-worker-source";
import { spawnLiquidObjectProcess } from "./liquid-object-worker-process";
import { bootstrapLiquidObjectProcess } from "./liquid-object-worker-bootstrap";

export type { ParticleSamplerIdentity as LiquidObjectWorkerIdentity } from "./particle-sampler-identity";

declare global {
	interface ImportMeta {
		readonly __ROCUT_PACKED_LIQUID_OBJECT_MODULE_V1__?: string;
	}
}

/** Host-only: author code never receives module/path/env/operation selection. */
export async function createLiquidObjectWorker(options: {
	frameJson: string;
	bootstrapTimeoutMs: number;
	signal: AbortSignal;
	expectedIdentity?: unknown;
}) {
	validateParticleBootstrapTimeout(options.bootstrapTimeoutMs);
	options.signal.throwIfAborted();
	const packedModule = import.meta.__ROCUT_PACKED_LIQUID_OBJECT_MODULE_V1__;
	if (packedModule !== undefined && packedModule !== "./liquid-object-wasm.mjs")
		throw Error("Invalid fixed Liquid worker module literal");
	const captured = captureLiquidObjectWorkerSource({
		moduleUrl:
			packedModule === undefined
				? pathToFileURL(
						createRequire(import.meta.url).resolve("opencut-wasm/sync"),
					).href
				: new URL(packedModule, import.meta.url).href,
		workerEntryUrl: new URL("./liquid-object-worker-entry.mjs", import.meta.url)
			.href,
		layout: packedModule === undefined ? "source-sync" : "packed-sidecar",
	});
	const expected =
		options.expectedIdentity === undefined
			? undefined
			: snapshotParticleSamplerIdentity(options.expectedIdentity);
	if (expected)
		assertParticleSamplerIdentity(
			expected,
			completeParticleSamplerIdentity(captured.identityBase, expected),
		);
	options.signal.throwIfAborted();
	const worker = await bootstrapLiquidObjectProcess({
		spawned: spawnLiquidObjectProcess(captured),
		frameJson: options.frameJson,
		bootstrapTimeoutMs: options.bootstrapTimeoutMs,
		signal: options.signal,
	});
	try {
		const identity = completeParticleSamplerIdentity(
			captured.identityBase,
			worker,
		);
		if (expected) assertParticleSamplerIdentity(expected, identity);
		return { ...worker, identity };
	} catch (error) {
		await worker.terminate();
		throw error;
	}
}
