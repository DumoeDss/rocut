import { randomUUID } from "node:crypto";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import { threeBuildCapability } from "./three-capability";
import { createLiquidObjectWorker } from "./liquid-object-worker";
import { getThreeLiquidObjectAdapterHash } from "./three-liquid-object-adapter";
import {
	snapshotThreeLiquidObjectCompileIdentity,
	type ThreeLiquidObjectCompileIdentity,
	type ThreeLiquidObjectRuntime,
} from "./three-liquid-object-identity";
import { record } from "./engines/three-liquid-object-transport-publication";
import {
	loadProgrammaticResource,
	type ProgrammaticResourceStore,
} from "./resources";
import type { ParticleSamplerIdentity } from "./particle-sampler-identity";

export const THREE_LIQUID_OBJECT_CAPABILITY = "liquid-object-v1" as const;

export function hasThreeLiquidObjectCapability(source: ProgrammaticSource) {
	return threeBuildCapability(source) === THREE_LIQUID_OBJECT_CAPABILITY;
}

/** Both directions are checked during build; painting loads this archive only
 * after an explicit capability. Legacy ordinary Three gets no native grant. */
export function parseThreeLiquidObjectArchive({
	source,
	body,
}: {
	source: ProgrammaticSource;
	body: ArrayBuffer;
}): ThreeLiquidObjectCompileIdentity | undefined {
	const declared = hasThreeLiquidObjectCapability(source);
	if (body.byteLength > 4 * 1024 * 1024)
		throw Error("Three Liquid archive exceeds the identity limit");
	const lock: unknown = JSON.parse(
		new TextDecoder("utf-8", { fatal: true }).decode(body),
	);
	const isRecord = (value: unknown): value is Record<string, unknown> =>
		!!value && typeof value === "object" && !Array.isArray(value);
	if (!isRecord(lock))
		throw Error("Invalid Three Liquid archive lock; explicitly recompile");
	const input = lock;
	if (
		input.version !== 1 ||
		Object.hasOwn(input, "threeLiquidObject") !== declared
	)
		throw Error(
			"Three Liquid capability/archive mismatch; explicitly recompile",
		);
	if (!declared) return undefined;
	if (Object.hasOwn(input, "threeParticle"))
		throw Error("Three Liquid archive cannot contain a particle grant");
	const identity = snapshotThreeLiquidObjectCompileIdentity(
		input.threeLiquidObject,
	);
	const adapter = record({
		value: input.adapter,
		keys: ["id", "version", "sha256"],
	});
	if (
		adapter.id !== "rocut-three-html" ||
		adapter.version !== 1 ||
		adapter.sha256 !== identity.adapterSha256
	)
		throw Error("Three Liquid adapter/archive mismatch; explicitly recompile");
	return identity;
}

export function assertCurrentThreeLiquidObjectAdapter(
	archived: ThreeLiquidObjectCompileIdentity,
	staticSvg = false,
) {
	if (archived.adapterSha256 !== getThreeLiquidObjectAdapterHash(staticSvg))
		throw Error("Archived Three Liquid adapter changed; explicitly recompile");
}

export async function loadThreeLiquidObjectArchive(options: {
	source: ProgrammaticSource;
	resourceStore: ProgrammaticResourceStore;
	signal: AbortSignal;
}) {
	options.signal.throwIfAborted();
	if (!hasThreeLiquidObjectCapability(options.source)) return undefined;
	const resource = options.source.build!.toolchainLock;
	if (resource.byteLength > 4 * 1024 * 1024)
		throw Error("Three Liquid archive exceeds the identity limit");
	const archive = await loadProgrammaticResource({
		...options.resourceStore,
		resource,
		signal: options.signal,
	});
	return parseThreeLiquidObjectArchive({
		source: options.source,
		body: archive.body,
	});
}

/** Same fixed worker as capture. Discovery receives a Host-only synthetic frame,
 * never author parameters, and releases its actual process before returning. */
export async function loadThreeLiquidObjectRuntime({
	signal,
	expectedIdentity,
}: {
	signal: AbortSignal;
	expectedIdentity?: ParticleSamplerIdentity;
}): Promise<ThreeLiquidObjectRuntime> {
	const worker = await createLiquidObjectWorker({
		frameJson: JSON.stringify({
			sessionId: `compile-${randomUUID()}`,
			index: 0,
			time: 0,
			seed: 0,
		}),
		bootstrapTimeoutMs: 5000,
		signal,
		expectedIdentity,
	});
	try {
		signal.throwIfAborted();
		return Object.freeze({
			policy: worker.policy,
			policyJson: worker.policyJson,
			policyHash: worker.policyHash,
			publishedPolicyHash: worker.publishedPolicyHash,
			identity: worker.identity,
		});
	} finally {
		await worker.terminate();
		signal.throwIfAborted();
	}
}
