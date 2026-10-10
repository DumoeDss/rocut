import { createHash } from "node:crypto";
import {
	parseLiquidTransportPolicy,
	record,
	type LiquidTransportPolicy,
} from "./engines/three-liquid-object-transport-publication";
import {
	snapshotParticleSamplerIdentity,
	type ParticleSamplerIdentity,
} from "./particle-sampler-identity";

export const THREE_LIQUID_OBJECT_PROFILE = "three-liquid-object-v1" as const;
export const liquidIdentityDigest = (value: string) =>
	createHash("sha256").update(value).digest("hex");

export interface ThreeLiquidObjectRuntime {
	readonly policyJson: string;
	readonly policy: Readonly<LiquidTransportPolicy>;
	readonly policyHash: string;
	readonly publishedPolicyHash: string;
	readonly identity: ParticleSamplerIdentity;
}
export interface ThreeLiquidObjectCompileIdentity {
	readonly version: 1;
	readonly profile: typeof THREE_LIQUID_OBJECT_PROFILE;
	readonly transportPolicy: Readonly<LiquidTransportPolicy>;
	readonly policyHash: string;
	readonly publishedPolicyHash: string;
	readonly workerIdentity: ParticleSamplerIdentity;
	readonly adapterSha256: string;
	readonly identityHash: string;
}

function material(input: Record<string, unknown>) {
	const { policyHash, publishedPolicyHash, adapterSha256 } = input;
	if (
		input.version !== 1 ||
		input.profile !== THREE_LIQUID_OBJECT_PROFILE ||
		typeof policyHash !== "string" ||
		typeof publishedPolicyHash !== "string" ||
		typeof adapterSha256 !== "string" ||
		![policyHash, publishedPolicyHash, adapterSha256].every((hash) =>
			/^[a-f0-9]{64}$/.test(hash),
		)
	)
		throw Error("Invalid Three Liquid compile identity");
	const transportPolicy = parseLiquidTransportPolicy(
		JSON.stringify(input.transportPolicy),
	);
	const workerIdentity = snapshotParticleSamplerIdentity(input.workerIdentity);
	if (
		liquidIdentityDigest(JSON.stringify(transportPolicy)) !== policyHash ||
		policyHash !== publishedPolicyHash ||
		workerIdentity.policyHash !== policyHash ||
		workerIdentity.publishedPolicyHash !== publishedPolicyHash
	)
		throw Error("Three Liquid worker policy publication mismatch");
	return Object.freeze({
		version: 1 as const,
		profile: THREE_LIQUID_OBJECT_PROFILE,
		transportPolicy,
		policyHash,
		publishedPolicyHash,
		workerIdentity,
		adapterSha256,
	});
}

export function threeLiquidObjectCompileIdentity({
	runtime,
	adapterSha256,
}: {
	runtime: ThreeLiquidObjectRuntime;
	adapterSha256: string;
}): ThreeLiquidObjectCompileIdentity {
	if (
		runtime.policyJson !== JSON.stringify(runtime.policy) ||
		liquidIdentityDigest(runtime.policyJson) !== runtime.policyHash
	)
		throw Error("Three Liquid publication bytes changed");
	const result = material({
		version: 1,
		profile: THREE_LIQUID_OBJECT_PROFILE,
		transportPolicy: runtime.policy,
		policyHash: runtime.policyHash,
		publishedPolicyHash: runtime.publishedPolicyHash,
		workerIdentity: runtime.identity,
		adapterSha256,
	});
	return Object.freeze({
		...result,
		identityHash: liquidIdentityDigest(JSON.stringify(result)),
	});
}

export function snapshotThreeLiquidObjectCompileIdentity(
	value: unknown,
): ThreeLiquidObjectCompileIdentity {
	const input = record({
		value,
		keys: [
			"version",
			"profile",
			"transportPolicy",
			"policyHash",
			"publishedPolicyHash",
			"workerIdentity",
			"adapterSha256",
			"identityHash",
		],
	});
	const result = material(input);
	const identityHash = liquidIdentityDigest(JSON.stringify(result));
	if (input.identityHash !== identityHash)
		throw Error(
			"Three Liquid archive identity digest mismatch; explicitly recompile",
		);
	return Object.freeze({ ...result, identityHash });
}

export function assertThreeLiquidObjectCompileIdentity({
	archived,
	current,
}: {
	archived: unknown;
	current: unknown;
}): void {
	if (
		snapshotThreeLiquidObjectCompileIdentity(archived).identityHash !==
		snapshotThreeLiquidObjectCompileIdentity(current).identityHash
	)
		throw Error("Archived Three Liquid identity differs; explicitly recompile");
}
