import { createHash } from "node:crypto";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import {
	parseParticleTransportPolicy,
	type ParticleTransportPolicy,
} from "./particle-policy";
import {
	snapshotParticleSamplerIdentity,
	type ParticleSamplerIdentity,
} from "./particle-sampler-identity";
import { createParticleSamplerWorker } from "./particle-sampler-worker";
import { getThreeParticleAdapterHash } from "./three-particle-adapter";
import { threeBuildCapability } from "./three-capability";
export { getThreeParticleAdapterHash } from "./three-particle-adapter";
import {
	loadProgrammaticResource,
	type ProgrammaticResourceStore,
} from "./resources";

export const THREE_PARTICLE_CAPABILITY = "particle-surface-v1" as const;
export const THREE_PARTICLE_PROFILE = "three-particle-surface-v1" as const;
const HASH = /^[a-f0-9]{64}$/;
const digest = (value: string) =>
	createHash("sha256").update(value).digest("hex");
const recompile = () =>
	Error(
		"Archived Three particle identity differs; explicitly recompile with the configured sampler and driver",
	);

/** Publication from the fixed Host worker, never values supplied by authored input. */
export interface ThreeParticleRuntime {
	readonly transportPolicy: ParticleTransportPolicy;
	readonly policyJson: string;
	readonly policyHash: string;
	readonly publishedPolicyHash: string;
	readonly samplerIdentity: ParticleSamplerIdentity;
}

/** Portable compile/capture requirement. No executable paths or author-selected
 * modules are accepted. The full effective policy is archived, not a TS default. */
export interface ThreeParticleCompileIdentity {
	readonly version: 1;
	readonly profile: typeof THREE_PARTICLE_PROFILE;
	readonly transportPolicy: ParticleTransportPolicy;
	readonly policyHash: string;
	readonly publishedPolicyHash: string;
	readonly samplerIdentity: ParticleSamplerIdentity;
	readonly adapterSha256: string;
	readonly identityHash: string;
}

function object(
	value: unknown,
	keys: readonly string[],
): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw recompile();
	const result = value as Record<string, unknown>;
	if (
		Object.keys(result).length !== keys.length ||
		keys.some((key) => !Object.hasOwn(result, key))
	)
		throw recompile();
	return result;
}

export function hasThreeParticleCapability(
	source: ProgrammaticSource,
): boolean {
	return threeBuildCapability(source) === THREE_PARTICLE_CAPABILITY;
}

function material(value: Record<string, unknown>) {
	if (
		value.version !== 1 ||
		value.profile !== THREE_PARTICLE_PROFILE ||
		typeof value.adapterSha256 !== "string" ||
		!HASH.test(value.adapterSha256) ||
		typeof value.policyHash !== "string" ||
		!HASH.test(value.policyHash) ||
		typeof value.publishedPolicyHash !== "string" ||
		!HASH.test(value.publishedPolicyHash)
	)
		throw recompile();
	const transportPolicy = parseParticleTransportPolicy(
		JSON.stringify(value.transportPolicy),
	);
	if (digest(JSON.stringify(transportPolicy)) !== value.policyHash)
		throw recompile();
	const samplerIdentity = snapshotParticleSamplerIdentity(
		value.samplerIdentity,
	);
	if (
		samplerIdentity.policyHash !== value.policyHash ||
		samplerIdentity.publishedPolicyHash !== value.publishedPolicyHash
	)
		throw recompile();
	return Object.freeze({
		version: 1 as const,
		profile: THREE_PARTICLE_PROFILE,
		transportPolicy,
		policyHash: value.policyHash,
		publishedPolicyHash: value.publishedPolicyHash,
		samplerIdentity,
		adapterSha256: value.adapterSha256,
	});
}

export function threeParticleCompileIdentity(
	runtime: ThreeParticleRuntime,
	adapterSha256: string,
): ThreeParticleCompileIdentity {
	if (
		runtime.policyJson !== JSON.stringify(runtime.transportPolicy) ||
		digest(runtime.policyJson) !== runtime.policyHash
	)
		throw Error("Three particle worker publication mismatch");
	const result = material({
		version: 1,
		profile: THREE_PARTICLE_PROFILE,
		transportPolicy: runtime.transportPolicy,
		policyHash: runtime.policyHash,
		publishedPolicyHash: runtime.publishedPolicyHash,
		samplerIdentity: runtime.samplerIdentity,
		adapterSha256,
	});
	return Object.freeze({
		...result,
		identityHash: digest(JSON.stringify(result)),
	});
}

export function snapshotThreeParticleCompileIdentity(
	value: unknown,
): ThreeParticleCompileIdentity {
	try {
		const input = object(value, [
			"version",
			"profile",
			"transportPolicy",
			"policyHash",
			"publishedPolicyHash",
			"samplerIdentity",
			"adapterSha256",
			"identityHash",
		]);
		const result = material(input);
		const identityHash = digest(JSON.stringify(result));
		if (input.identityHash !== identityHash) throw recompile();
		return Object.freeze({ ...result, identityHash });
	} catch (cause) {
		throw Error(recompile().message, { cause });
	}
}

export function assertThreeParticleCompileIdentity(
	archived: unknown,
	current: unknown,
): void {
	if (
		snapshotThreeParticleCompileIdentity(archived).identityHash !==
		snapshotThreeParticleCompileIdentity(current).identityHash
	)
		throw recompile();
}

/** Reject stale browser adapters before starting a sampler or authored code. */
export function assertCurrentThreeParticleAdapter(
	archived: ThreeParticleCompileIdentity,
	staticSvg = false,
): void {
	if (archived.adapterSha256 !== getThreeParticleAdapterHash(staticSvg))
		throw recompile();
}

/** Compile/rebuild already read the lock, so enforce both directions there.
 * Capture must only call the loading helper for an explicit capability. An
 * ordinary Three document still paints without loading its source archive, and
 * an unmarked document never receives a native particle grant. */
export function parseThreeParticleArchive(
	source: ProgrammaticSource,
	body: ArrayBuffer,
): ThreeParticleCompileIdentity | undefined {
	const declared = hasThreeParticleCapability(source);
	if (body.byteLength > 4 * 1024 * 1024)
		throw Error("Three archive lock exceeds the identity limit");
	let lock: Record<string, unknown>;
	try {
		const decoded: unknown = JSON.parse(
			new TextDecoder("utf-8", { fatal: true }).decode(body),
		);
		if (
			!decoded ||
			typeof decoded !== "object" ||
			Array.isArray(decoded) ||
			(decoded as Record<string, unknown>).version !== 1
		)
			throw recompile();
		lock = decoded as Record<string, unknown>;
	} catch (cause) {
		throw Error("Invalid Three particle archive lock; explicitly recompile", {
			cause,
		});
	}
	if (Object.hasOwn(lock, "threeParticle") !== declared) throw recompile();
	if (!declared) return undefined;
	if (Object.hasOwn(lock, "threeLiquidObject")) throw recompile();
	const identity = snapshotThreeParticleCompileIdentity(lock.threeParticle);
	const adapter = object(lock.adapter, ["id", "version", "sha256"]);
	if (
		adapter.id !== "rocut-three-html" ||
		adapter.version !== 1 ||
		adapter.sha256 !== identity.adapterSha256
	)
		throw recompile();
	return identity;
}

/** Load verified attachment bytes only after the source explicitly opts in.
 * Absence never probes the sampler or requires a legacy archive for painting. */
export async function loadThreeParticleArchive({
	source,
	resourceStore,
	signal,
}: {
	source: ProgrammaticSource;
	resourceStore: ProgrammaticResourceStore;
	signal: AbortSignal;
}): Promise<ThreeParticleCompileIdentity | undefined> {
	signal.throwIfAborted();
	if (!hasThreeParticleCapability(source)) return undefined;
	const resource = source.build!.toolchainLock;
	if (resource.byteLength > 4 * 1024 * 1024)
		throw Error("Three archive lock exceeds the identity limit");
	const archived = await loadProgrammaticResource({
		...resourceStore,
		resource,
		signal,
	});
	return parseThreeParticleArchive(source, archived.body);
}

/** Compile-time discovery executes the same fixed byte-bound worker as capture.
 * Return only after actual worker close; no shared module import or fallback. */
export async function loadThreeParticleRuntime(
	signal: AbortSignal,
	expectedIdentity?: ParticleSamplerIdentity,
): Promise<ThreeParticleRuntime> {
	const worker = await createParticleSamplerWorker({
		bootstrapTimeoutMs: 5000,
		signal,
		expectedIdentity,
	});
	try {
		await worker.ready;
		worker.check();
		signal.throwIfAborted();
		const transportPolicy = parseParticleTransportPolicy(worker.policyJson);
		const samplerIdentity = snapshotParticleSamplerIdentity(
			worker.samplerIdentity,
		);
		return Object.freeze({
			transportPolicy,
			policyJson: worker.policyJson,
			policyHash: worker.policyHash,
			publishedPolicyHash: worker.publishedPolicyHash,
			samplerIdentity,
		});
	} finally {
		await worker.terminateSampler();
		signal.throwIfAborted();
	}
}
