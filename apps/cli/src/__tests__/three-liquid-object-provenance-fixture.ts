import type {
	ProgrammaticSource,
	ProgrammaticBuildCapability,
} from "@opencut/editor-contracts";
import { completeParticleSamplerIdentity } from "../programmatic/particle-sampler-identity";
import { parseLiquidTransportPolicy } from "../programmatic/engines/three-liquid-object-transport-publication";
import {
	liquidIdentityDigest,
	threeLiquidObjectCompileIdentity,
	type ThreeLiquidObjectRuntime,
} from "../programmatic/three-liquid-object-identity";
import { describeResource } from "../programmatic/resource-bytes";
import { resourceDigest } from "../programmatic/resources";
import { particleTransportPolicyJson } from "./particle-policy-fixture.mjs";
import { parseParticleTransportPolicy } from "../programmatic/particle-policy";
import { threeParticleCompileIdentity } from "../programmatic/three-particle-provenance";

export const hash = liquidIdentityDigest;
export const adapterSha256 = hash("independent synthetic Liquid adapter");
export const bytes = (value: unknown) =>
	new TextEncoder().encode(JSON.stringify(value)).buffer;

// Schema double copied from native-final.exe policy publication; no worker/grant proof.
export const liquidPolicyJson =
	'{"version":1,"maxControlJsonBytes":8192,"maxVerticesPerRequest":100000,"maxRequestJsonBytes":12000000,"maxResponseJsonBytes":12000000,"maxRequestEnvelopeBytes":24004096,"maxResponseEnvelopeBytes":24004096,"maxMeshesPerFrame":32,"maxVerticesPerFrame":200000,"maxRequestsPerFrame":64,"maxEncodedBytesPerFrame":48000000,"maxRetainedPayloadBytesPerFrame":96000000,"maxInFlight":1,"requestTimeoutMs":15000,"frameTimeoutMs":30000,"cleanupTimeoutMs":5000,"initTimeoutMs":5000,"terminationTimeoutMs":5000}';

export function runtime({
	worker = "a",
	vertices = 200000,
} = {}): ThreeLiquidObjectRuntime {
	const policy = parseLiquidTransportPolicy(
		JSON.stringify({
			...JSON.parse(liquidPolicyJson),
			maxVerticesPerFrame: vertices,
		}),
	);
	const policyJson = JSON.stringify(policy),
		policyHash = hash(policyJson);
	const files = (["module", "glue", "wasm", "worker-entry"] as const).map(
		(role) => ({
			role,
			sha256: hash(role + worker),
			bytes: 12,
		}),
	);
	return {
		policy,
		policyJson,
		policyHash,
		publishedPolicyHash: policyHash,
		identity: completeParticleSamplerIdentity(
			{
				version: 1,
				bindingVersion: "inline-wasm-v1",
				layout: "source-sync",
				runtime: { name: "node", version: "v24.14.0" },
				files,
				executionHash: hash("execution" + worker),
				closureHash: hash(JSON.stringify(files)),
			},
			{ policyHash, publishedPolicyHash: policyHash },
		),
	};
}

export function archive({
	includeLiquid = true,
	capabilities = ["liquid-object-v1"],
	identity = threeLiquidObjectCompileIdentity({
		runtime: runtime(),
		adapterSha256: adapterSha256,
	}),
	lockPatch = {},
}: {
	includeLiquid?: boolean;
	capabilities?: readonly ProgrammaticBuildCapability[];
	identity?: unknown;
	lockPatch?: Record<string, unknown>;
} = {}) {
	const body = bytes({
		version: 1,
		packages: [],
		adapter: { id: "rocut-three-html", version: 1, sha256: adapterSha256 },
		...(includeLiquid ? { threeLiquidObject: identity } : {}),
		...lockPatch,
	});
	const resource = describeResource(
		{
			id: "_rocut/toolchain-lock.json",
			kind: "source",
			mimeType: "application/octet-stream",
		},
		body.byteLength,
		resourceDigest(body),
	);
	const source: ProgrammaticSource = {
		version: 1,
		runtime: "html-document",
		code: "",
		documentId: "_rocut/compiled.html",
		width: 64,
		height: 64,
		frameRate: { numerator: 24, denominator: 1 },
		durationFrames: 8,
		seed: 0,
		build: {
			version: 1,
			engine: "three",
			engineVersion: "0.185.1",
			entryFile: "index.ts",
			inputProps: {},
			...(capabilities ? { capabilities } : {}),
			inputs: [],
			toolchainLock: resource,
		},
	};
	return { body, source, resource };
}

export function particleIdentity() {
	const transportPolicy = parseParticleTransportPolicy(
		particleTransportPolicyJson(),
	);
	const policyJson = JSON.stringify(transportPolicy),
		policyHash = hash(policyJson);
	const worker = runtime().identity;
	const samplerIdentity = completeParticleSamplerIdentity(
		{
			version: 1,
			bindingVersion: worker.bindingVersion,
			layout: worker.layout,
			runtime: worker.runtime,
			files: worker.files,
			executionHash: worker.executionHash,
			closureHash: worker.closureHash,
		},
		{ policyHash, publishedPolicyHash: policyHash },
	);
	return threeParticleCompileIdentity(
		{
			transportPolicy,
			policyJson,
			policyHash,
			publishedPolicyHash: policyHash,
			samplerIdentity,
		},
		adapterSha256,
	);
}
