import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import { InMemoryProjectStore } from "@opencut/editor-ports/in-memory";
import { particleTransportPolicyJson } from "./particle-policy-fixture.mjs";
import {
	deriveParticleTransportPolicy,
	parseParticleTransportPolicy,
} from "../programmatic/particle-policy";
import {
	completeParticleSamplerIdentity,
	type ParticleSamplerIdentityBase,
} from "../programmatic/particle-sampler-identity";
import {
	assertThreeParticleCompileIdentity,
	assertCurrentThreeParticleAdapter,
	getThreeParticleAdapterHash,
	hasThreeParticleCapability,
	loadThreeParticleArchive,
	parseThreeParticleArchive,
	snapshotThreeParticleCompileIdentity,
	threeParticleCompileIdentity,
	type ThreeParticleRuntime,
} from "../programmatic/three-particle-provenance";
import {
	describeResource,
	saveResourceBytes,
} from "../programmatic/resource-bytes";
import { resourceDigest } from "../programmatic/resources";
import { loadEngineToolchain } from "../programmatic/engines/toolchain";
import { THREE_FRAME_DRIVER } from "../programmatic/engines/three-driver";
import { REMOTION_COMPILER_CHILD } from "../programmatic/engines/remotion-compiler-child";
import { THREE_PARTICLE_FRAME_DRIVER } from "../programmatic/engines/three-particle-driver";
import { PARTICLE_BROWSER_RUNTIME_IIFE } from "../programmatic/particle-browser-bundle.generated";
import { PARTICLE_CAPTURE_BOOTSTRAP } from "../programmatic/particle-page-bootstrap";
import { threeParticleHtmlAdapterMaterial } from "../programmatic/three-particle-adapter";

const hash = (value: string) =>
	createHash("sha256").update(value).digest("hex");
const adapterSha256 = hash("synthetic Three driver fixture");
const bytes = (value: unknown) =>
	new TextEncoder().encode(JSON.stringify(value)).buffer;

// Schema-only publication: not a substitute for the real worker/pack tests.
function runtime(
	options: { narrowed?: boolean; sampler?: string } = {},
): ThreeParticleRuntime {
	const publishedJson = particleTransportPolicyJson();
	const published = parseParticleTransportPolicy(publishedJson);
	const transportPolicy = options.narrowed
		? deriveParticleTransportPolicy(published, { maxSamples: 2048 })
		: published;
	const policyJson = JSON.stringify(transportPolicy),
		policyHash = hash(policyJson);
	const files = (["module", "glue", "wasm", "worker-entry"] as const).map(
		(role) => ({
			role,
			sha256: hash(role + (options.sampler ?? "a")),
			bytes: 12,
		}),
	);
	const base: ParticleSamplerIdentityBase = {
		version: 1,
		bindingVersion: "inline-wasm-v1",
		layout: "source-sync",
		runtime: { name: "node", version: "v24.14.0" },
		files,
		executionHash: hash("execution" + (options.sampler ?? "a")),
		closureHash: hash(JSON.stringify(files)),
	};
	const publishedPolicyHash = hash(publishedJson);
	return {
		transportPolicy,
		policyJson,
		policyHash,
		publishedPolicyHash,
		samplerIdentity: completeParticleSamplerIdentity(base, {
			policyHash,
			publishedPolicyHash,
		}),
	};
}

function archive(
	identity: unknown = threeParticleCompileIdentity(runtime(), adapterSha256),
	declared = true,
) {
	const body = bytes({
		version: 1,
		packages: [],
		adapter: { id: "rocut-three-html", version: 1, sha256: adapterSha256 },
		...(identity !== undefined ? { threeParticle: identity } : {}),
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
		frameRate: { numerator: 25, denominator: 1 },
		durationFrames: 8,
		seed: 0,
		build: {
			version: 1,
			engine: "three",
			engineVersion: "0.185.1",
			entryFile: "index.ts",
			inputProps: {},
			...(declared ? { capabilities: ["particle-surface-v1"] } : {}),
			inputs: [],
			toolchainLock: resource,
		},
	};
	return { source, resource, body };
}

test("Three particle provenance carries complete frozen policy and sampler identity schema without paths", () => {
	const publication = runtime();
	const identity = threeParticleCompileIdentity(publication, adapterSha256);
	expect(identity.transportPolicy).toEqual(publication.transportPolicy);
	expect(identity.samplerIdentity).toEqual(publication.samplerIdentity);
	expect(identity.policyHash).toBe(publication.policyHash);
	expect(identity.publishedPolicyHash).toBe(publication.publishedPolicyHash);
	for (const value of [
		identity,
		identity.transportPolicy,
		identity.transportPolicy.kernel,
		identity.transportPolicy.hostDefaults,
		identity.transportPolicy.hostDefaults.process,
		identity.samplerIdentity,
		identity.samplerIdentity.runtime,
		identity.samplerIdentity.files,
	])
		expect(Object.isFrozen(value)).toBe(true);
	expect(JSON.stringify(identity)).not.toMatch(/moduleUrl|directory|[A-Z]:\\/);
	expect(
		snapshotThreeParticleCompileIdentity(JSON.parse(JSON.stringify(identity))),
	).toEqual(identity);
	const archived = archive(identity);
	expect(parseThreeParticleArchive(archived.source, archived.body)).toEqual(
		identity,
	);
});

test("capability and archive identity must agree in both directions; no silent legacy upgrade", () => {
	const marked = archive();
	const ordinaryBody = bytes({
		version: 1,
		packages: [],
		adapter: { id: "rocut-three-html", version: 1, sha256: adapterSha256 },
	});
	expect(() => parseThreeParticleArchive(marked.source, ordinaryBody)).toThrow(
		"explicitly recompile",
	);
	const unmarked = archive(
		threeParticleCompileIdentity(runtime(), adapterSha256),
		false,
	);
	expect(() =>
		parseThreeParticleArchive(unmarked.source, unmarked.body),
	).toThrow("explicitly recompile");
	expect(
		parseThreeParticleArchive(unmarked.source, ordinaryBody),
	).toBeUndefined();
	for (const capabilities of [
		null,
		[],
		["unknown"],
		["particle-surface-v1", "particle-surface-v1"],
	]) {
		const source = {
			...marked.source,
			build: { ...marked.source.build!, capabilities },
		} as unknown as ProgrammaticSource;
		expect(() => hasThreeParticleCapability(source)).toThrow(
			"Invalid explicit",
		);
	}
	for (const engine of ["remotion", "hyperframes"] as const)
		expect(() =>
			hasThreeParticleCapability({
				...marked.source,
				build: { ...marked.source.build!, engine },
			}),
		).toThrow("Invalid explicit");
});

test("effective policy, sampler bytes, runtime and driver changes all require explicit recompile", () => {
	const identity = threeParticleCompileIdentity(runtime(), adapterSha256);
	const alternatives = [
		threeParticleCompileIdentity(runtime({ narrowed: true }), adapterSha256),
		threeParticleCompileIdentity(runtime({ sampler: "b" }), adapterSha256),
		threeParticleCompileIdentity(runtime(), hash("changed driver")),
	];
	const differentRuntime = runtime();
	const {
		identityHash: _identityHash,
		publishedPolicyHash,
		policyHash,
		...base
	} = differentRuntime.samplerIdentity;
	const samplerIdentity = completeParticleSamplerIdentity(
		{ ...base, runtime: { name: "bun", version: "1.2.18" } },
		{ policyHash, publishedPolicyHash },
	);
	alternatives.push(
		threeParticleCompileIdentity(
			{ ...differentRuntime, samplerIdentity },
			adapterSha256,
		),
	);
	for (const changed of alternatives) {
		expect(changed.identityHash).not.toBe(identity.identityHash);
		expect(() => assertThreeParticleCompileIdentity(identity, changed)).toThrow(
			"explicitly recompile",
		);
	}
	expect(() =>
		assertThreeParticleCompileIdentity(
			identity,
			JSON.parse(JSON.stringify(identity)),
		),
	).not.toThrow();
});

test("particle adapter binds shipped driver, compiler, browser runtime and capture relay bytes", () => {
	const parts = [
		"rocut-three-particle-adapter-v1",
		THREE_PARTICLE_FRAME_DRIVER,
		REMOTION_COMPILER_CHILD,
		PARTICLE_BROWSER_RUNTIME_IIFE,
		PARTICLE_CAPTURE_BOOTSTRAP,
		threeParticleHtmlAdapterMaterial(),
	];
	const current = getThreeParticleAdapterHash();
	expect(current).toBe(hash(JSON.stringify(parts)));
	for (let index = 1; index < parts.length; index++) {
		const changed = [...parts];
		changed[index] += "\n/* changed artifact */";
		const stale = threeParticleCompileIdentity(
			runtime(),
			hash(JSON.stringify(changed)),
		);
		expect(() => assertCurrentThreeParticleAdapter(stale)).toThrow(
			"explicitly recompile",
		);
	}
	expect(() =>
		assertCurrentThreeParticleAdapter(
			threeParticleCompileIdentity(runtime(), current),
		),
	).not.toThrow();
});

test("malformed, incomplete and forged identities cannot be repaired from current defaults", () => {
	const identity = threeParticleCompileIdentity(runtime(), adapterSha256);
	for (const invalid of [
		null,
		{},
		{ ...identity, future: true },
		{ ...identity, profile: "old-particle" },
		{ ...identity, transportPolicy: {} },
		{ ...identity, policyHash: hash("false policy") },
		{
			...identity,
			samplerIdentity: {
				...identity.samplerIdentity,
				moduleUrl: "file:///untrusted",
			},
		},
		{ ...identity, adapterSha256: hash("unrecorded driver") },
		{ ...identity, identityHash: "0".repeat(64) },
	])
		expect(() => snapshotThreeParticleCompileIdentity(invalid)).toThrow(
			"explicitly recompile",
		);
	const wrongAdapter = archive(identity);
	const lock = JSON.parse(new TextDecoder().decode(wrongAdapter.body));
	lock.adapter.sha256 = hash("mismatched actual adapter");
	expect(() =>
		parseThreeParticleArchive(wrongAdapter.source, bytes(lock)),
	).toThrow("explicitly recompile");
	expect(() =>
		threeParticleCompileIdentity(
			{ ...runtime(), policyJson: "{}" },
			adapterSha256,
		),
	).toThrow("publication mismatch");
});

test("capture loader keeps ordinary Three archive-free and checks opted-in attachment integrity", async () => {
	const ordinary = archive(undefined, false);
	const resourceStore = {
		projectId: "three-particle-provenance",
		store: new InMemoryProjectStore(),
	};
	expect(
		await loadThreeParticleArchive({
			source: ordinary.source,
			resourceStore,
			signal: new AbortController().signal,
		}),
	).toBeUndefined();
	const opted = archive();
	await expect(
		loadThreeParticleArchive({
			source: opted.source,
			resourceStore,
			signal: new AbortController().signal,
		}),
	).rejects.toThrow("Missing programmatic resource");
	await saveResourceBytes(resourceStore, opted);
	expect(
		await loadThreeParticleArchive({
			source: opted.source,
			resourceStore,
			signal: new AbortController().signal,
		}),
	).toEqual(parseThreeParticleArchive(opted.source, opted.body));
	await resourceStore.store.saveAttachment({
		projectId: resourceStore.projectId,
		key: opted.resource.attachmentKey,
		body: bytes({ version: 1 }),
		metadata: {
			kind: "programmatic-resource",
			version: 1,
			mimeType: opted.resource.mimeType,
			byteLength: opted.resource.byteLength,
			sha256: opted.resource.sha256,
		},
	});
	await expect(
		loadThreeParticleArchive({
			source: opted.source,
			resourceStore,
			signal: new AbortController().signal,
		}),
	).rejects.toThrow("integrity mismatch");
	const aborted = new AbortController();
	aborted.abort(Error("cancelled provenance"));
	await expect(
		loadThreeParticleArchive({
			source: ordinary.source,
			resourceStore,
			signal: aborted.signal,
		}),
	).rejects.toThrow("cancelled provenance");
});

test.skipIf(!process.env.ROCUT_TEST_THREE_TOOLCHAIN)(
	"toolchain keeps legacy Three lock bytes and adds particle provenance only on explicit admission",
	async () => {
		const directory = process.env.ROCUT_TEST_THREE_TOOLCHAIN!;
		const signal = new AbortController().signal;
		const ordinary = await loadEngineToolchain(directory, "three", signal);
		const legacy = JSON.parse(new TextDecoder().decode(ordinary.lock.body));
		expect(Object.keys(legacy)).toEqual(["version", "packages", "adapter"]);
		expect(legacy.adapter).toEqual({
			id: "rocut-three-html",
			version: 1,
			sha256: hash(THREE_FRAME_DRIVER + "\n" + REMOTION_COMPILER_CHILD),
		});
		const admitted = await loadEngineToolchain(
			directory,
			"three",
			signal,
			undefined,
			runtime(),
		);
		const lock = JSON.parse(new TextDecoder().decode(admitted.lock.body));
		const { threeParticle, adapter, ...withoutParticle } = lock;
		expect(bytes({ ...withoutParticle, adapter: legacy.adapter })).toEqual(
			ordinary.lock.body,
		);
		expect(adapter.sha256).toBe(getThreeParticleAdapterHash());
		expect(adapter.sha256).not.toBe(legacy.adapter.sha256);
		expect(threeParticle).toEqual(
			threeParticleCompileIdentity(runtime(), getThreeParticleAdapterHash()),
		);
		expect(admitted.lock.resource.sha256).not.toBe(
			ordinary.lock.resource.sha256,
		);
		const marked = archive();
		expect(
			parseThreeParticleArchive(marked.source, admitted.lock.body)
				?.identityHash,
		).toBe(threeParticle.identityHash);
		await expect(
			loadEngineToolchain(directory, "remotion", signal, undefined, runtime()),
		).rejects.toThrow("explicit Three capability");
		await expect(
			loadEngineToolchain(
				directory,
				"hyperframes",
				signal,
				undefined,
				runtime(),
			),
		).rejects.toThrow("explicit Three capability");
	},
);
