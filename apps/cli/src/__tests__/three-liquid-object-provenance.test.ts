import { expect, test } from "bun:test";
import { InMemoryProjectStore } from "@opencut/editor-ports/in-memory";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import {
	archive,
	runtime,
	adapterSha256,
	hash,
	particleIdentity,
} from "./three-liquid-object-provenance-fixture";
import { threeBuildCapability } from "../programmatic/three-capability";
import {
	assertThreeLiquidObjectCompileIdentity,
	snapshotThreeLiquidObjectCompileIdentity,
	threeLiquidObjectCompileIdentity,
	type ThreeLiquidObjectCompileIdentity,
} from "../programmatic/three-liquid-object-identity";
import {
	hasThreeLiquidObjectCapability,
	parseThreeLiquidObjectArchive,
	loadThreeLiquidObjectArchive,
	assertCurrentThreeLiquidObjectAdapter,
} from "../programmatic/three-liquid-object-provenance";
import { getThreeLiquidObjectAdapterHash } from "../programmatic/three-liquid-object-adapter";
import {
	hasThreeParticleCapability,
	parseThreeParticleArchive,
} from "../programmatic/three-particle-provenance";
type Mutable<T> = T extends object
	? { -readonly [K in keyof T]: Mutable<T[K]> }
	: T;

test("explicit Liquid identity roundtrips frozen policy, worker closure and archive", () => {
	const publication = runtime(),
		identity = threeLiquidObjectCompileIdentity({
			runtime: publication,
			adapterSha256: adapterSha256,
		});
	expect(identity.profile).toBe("three-liquid-object-v1");
	expect(identity.workerIdentity.files.map((file) => file.role)).toEqual([
		"module",
		"glue",
		"wasm",
		"worker-entry",
	]);
	expect(identity.transportPolicy).toEqual(publication.policy);
	expect(
		snapshotThreeLiquidObjectCompileIdentity(
			JSON.parse(JSON.stringify(identity)),
		),
	).toEqual(identity);
	const archived = archive({ identity });
	expect(
		parseThreeLiquidObjectArchive({
			source: archived.source,
			body: archived.body,
		}),
	).toEqual(identity);
	for (const value of [
		identity,
		identity.transportPolicy,
		identity.workerIdentity,
		identity.workerIdentity.files,
		identity.workerIdentity.runtime,
	])
		expect(Object.isFrozen(value)).toBe(true);
});

test("archive and explicit capability must agree in both directions", () => {
	const marked = archive({ includeLiquid: false });
	expect(() =>
		parseThreeLiquidObjectArchive({ source: marked.source, body: marked.body }),
	).toThrow();
	const unmarked = archive();
	const unmarkedSource = {
		...unmarked.source,
		build: { ...unmarked.source.build!, capabilities: undefined },
	};
	expect(() =>
		parseThreeLiquidObjectArchive({
			source: unmarkedSource,
			body: unmarked.body,
		}),
	).toThrow();
	for (const capabilities of [
		[],
		["unknown"],
		["liquid-object-v1", "liquid-object-v1"],
		["liquid-object-v1", "particle-surface-v1"],
	]) {
		const fixture = archive();
		// Untrusted JSON boundary deliberately carries values outside the typed capability union.
		const source: ProgrammaticSource = JSON.parse(
			JSON.stringify({
				...fixture.source,
				build: { ...fixture.source.build!, capabilities },
			}),
		);
		expect(() => threeBuildCapability(source)).toThrow();
		expect(() =>
			parseThreeLiquidObjectArchive({ source: source, body: fixture.body }),
		).toThrow();
	}
	for (const engine of ["remotion", "hyperframes"] as const) {
		const fixture = archive();
		const source = {
			...fixture.source,
			build: { ...fixture.source.build!, engine },
		};
		expect(() => hasThreeLiquidObjectCapability(source)).toThrow();
	}
});

test("particle and Liquid capabilities do not grant one another or permit mixed archives", () => {
	const liquid = archive();
	expect(hasThreeParticleCapability(liquid.source)).toBe(false);
	expect(hasThreeLiquidObjectCapability(liquid.source)).toBe(true);
	const particleGrant = particleIdentity();
	const particle = archive({
		includeLiquid: false,
		capabilities: ["particle-surface-v1"],
		lockPatch: { threeParticle: particleGrant },
	});
	expect(hasThreeLiquidObjectCapability(particle.source)).toBe(false);
	expect(hasThreeParticleCapability(particle.source)).toBe(true);
	expect(parseThreeParticleArchive(particle.source, particle.body)).toEqual(
		particleGrant,
	);
	expect(() =>
		parseThreeParticleArchive(particle.source, liquid.body),
	).toThrow();
	expect(() =>
		parseThreeLiquidObjectArchive({
			source: liquid.source,
			body: particle.body,
		}),
	).toThrow();
	const mixed = archive({ lockPatch: { threeParticle: particleGrant } });
	expect(() =>
		parseThreeLiquidObjectArchive({ source: mixed.source, body: mixed.body }),
	).toThrow();
	expect(() =>
		parseThreeParticleArchive(particle.source, mixed.body),
	).toThrow();
});

test("policy, worker, execution and adapter changes require explicit recompile", () => {
	const identity = threeLiquidObjectCompileIdentity({
		runtime: runtime(),
		adapterSha256: adapterSha256,
	});
	for (const current of [
		threeLiquidObjectCompileIdentity({
			runtime: runtime({ vertices: 100000 }),
			adapterSha256: adapterSha256,
		}),
		threeLiquidObjectCompileIdentity({
			runtime: runtime({ worker: "b" }),
			adapterSha256: adapterSha256,
		}),
		threeLiquidObjectCompileIdentity({
			runtime: runtime(),
			adapterSha256: hash("other adapter"),
		}),
	])
		expect(() =>
			assertThreeLiquidObjectCompileIdentity({
				archived: identity,
				current: current,
			}),
		).toThrow();
	const adapter = getThreeLiquidObjectAdapterHash();
	expect(() =>
		assertCurrentThreeLiquidObjectAdapter(
			threeLiquidObjectCompileIdentity({
				runtime: runtime(),
				adapterSha256: adapter,
			}),
		),
	).not.toThrow();
	expect(() => assertCurrentThreeLiquidObjectAdapter(identity)).toThrow();
	expect(() =>
		threeLiquidObjectCompileIdentity({
			runtime: { ...runtime(), policyJson: "{}" },
			adapterSha256: adapterSha256,
		}),
	).toThrow();
});

test("untrusted policy, worker closure, aggregate digests and adapter lock tampering reject", () => {
	const identity = threeLiquidObjectCompileIdentity({
		runtime: runtime(),
		adapterSha256: adapterSha256,
	});
	const mutate = (
		change: (value: Mutable<ThreeLiquidObjectCompileIdentity>) => void,
	) => {
		const value: Mutable<ThreeLiquidObjectCompileIdentity> = JSON.parse(
			JSON.stringify(identity),
		);
		change(value);
		expect(() => snapshotThreeLiquidObjectCompileIdentity(value)).toThrow();
	};
	mutate((value) => {
		value.transportPolicy.maxVerticesPerFrame++;
	});
	mutate((value) => {
		value.policyHash = hash("forged policy");
	});
	mutate((value) => {
		value.publishedPolicyHash = hash("forged publication");
	});
	mutate((value) => {
		value.workerIdentity.files[0].sha256 = hash("forged module");
	});
	mutate((value) => {
		value.workerIdentity.executionHash = hash("forged execution");
	});
	mutate((value) => {
		value.workerIdentity.closureHash = hash("forged closure");
	});
	mutate((value) => {
		value.workerIdentity.identityHash = hash("forged worker");
	});
	mutate((value) => {
		value.adapterSha256 = hash("forged adapter");
	});
	mutate((value) => {
		value.identityHash = hash("forged aggregate");
	});
	const forged = archive({
		lockPatch: {
			adapter: {
				id: "rocut-three-html",
				version: 1,
				sha256: hash("different lock"),
			},
		},
	});
	expect(() =>
		parseThreeLiquidObjectArchive({ source: forged.source, body: forged.body }),
	).toThrow();
	expect(() =>
		parseThreeLiquidObjectArchive({
			source: forged.source,
			body: new Uint8Array([0xff]).buffer,
		}),
	).toThrow();
});

test("plain Three paint requires neither Liquid archive attachment nor native worker", async () => {
	const plain = archive({ includeLiquid: false });
	const plainSource = {
		...plain.source,
		build: { ...plain.source.build!, capabilities: undefined },
	};
	expect(threeBuildCapability(plainSource)).toBeUndefined();
	expect(
		parseThreeLiquidObjectArchive({ source: plainSource, body: plain.body }),
	).toBeUndefined();
	const source: ProgrammaticSource = { ...plainSource, build: undefined };
	expect(
		await loadThreeLiquidObjectArchive({
			source,
			resourceStore: {
				projectId: "no-liquid-attachments",
				store: new InMemoryProjectStore(),
			},
			signal: new AbortController().signal,
		}),
	).toBeUndefined();
});
