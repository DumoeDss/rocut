import { expect, test } from "bun:test";
import { createHeartOwnerProvider } from "./mv-heart-owner-provider";
import {
	FakeOwner,
	source,
	bitmap,
	capabilityJson,
	sha,
} from "./mv-heart-owner-provider-test-fixture";
import type { MvHeartSkyOwnerIdentity } from "../../../../../editor-contracts/src/mv-heart-plan";
import type { MvHeartSkySettings } from "../../../../../editor-contracts/src/mv-heart";
const named = (id: string) => {
	const input = source();
	return { ...input, resource: { ...input.resource, id } };
};
/** Protocol fixture only. Native decoding and geometry parity remain separate gates. */
class SkyOwner extends FakeOwner {
	skyEntries = new Map<
		number,
		{ identity: MvHeartSkyOwnerIdentity; reservedBytes: number }
	>();
	mutateSky?: (identity: MvHeartSkyOwnerIdentity) => void;
	badSkyFrame = false;
	// eslint-disable-next-line opencut/prefer-object-params -- Preserve the WASM typed-array boundary.
	prepareSky(metadata: string, encoded: Uint8Array, rgba: Uint8Array) {
		const input: {
			binding: MvHeartSkyOwnerIdentity["binding"];
			character: MvHeartSkyOwnerIdentity["character"];
			settings: MvHeartSkySettings;
			ceilingBytes: number;
			encodedLayout: {
				source: { offset: number; length: number };
				character: { offset: number; length: number };
			};
			decodedLayout: {
				source: { offset: number; length: number };
				character: { offset: number; length: number };
			};
		} = JSON.parse(metadata);
		for (const role of ["source", "character"] as const) {
			const binding = role === "source" ? input.binding : input.character;
			const e = input.encodedLayout[role],
				d = input.decodedLayout[role];
			expect(sha(encoded.subarray(e.offset, e.offset + e.length))).toBe(
				binding.source.sha256,
			);
			expect(sha(rgba.subarray(d.offset, d.offset + d.length))).toBe(
				binding.decodedRgbaSha256,
			);
		}
		const a = input.settings;
		const session = this.next++;
		this.skyEntries.set(session, {
			reservedBytes: input.ceilingBytes,
			identity: {
				ownerId: 99,
				sessionId: session,
				binding: input.binding,
				character: input.character,
				settings: {
					bg: a.bg,
					char: a.char,
					seed: a.seed ?? null,
					night: a.night ?? null,
					impact: a.impact ?? null,
					releaseBeat: a.releaseBeat ?? null,
					bands: a.bands ?? null,
					charX: a.charX ?? null,
					charH: a.charH ?? null,
				},
				imagesManifestSha256: sha(new TextEncoder().encode("[]")),
			},
		});
		return session;
	}
	manifestJson(session: number) {
		const entry = this.skyEntries.get(session);
		if (!entry) return super.manifestJson(session);
		const identity = structuredClone(entry.identity);
		this.mutateSky?.(identity);
		return JSON.stringify({
			kind: "skyShatter",
			identity,
			images: [],
			reservedBytes: entry.reservedBytes,
		});
	}
	frameJson(session: number) {
		const entry = this.skyEntries.get(session);
		if (!entry) return super.frameJson(session);
		return JSON.stringify({
			kind: this.badSkyFrame ? "heartShatter" : "skyShatter",
			identity: entry.identity,
			plan: {
				rasterBudgetBytes: 1024,
				commands: [
					{
						kind: "surface",
						id: "sky-night",
						size: [64, 64],
						commands: [
							{
								kind: "filteredPath",
								transform: [1, 0, 0, 1, 0, 0],
								operations: [],
								path: [
									{ kind: "moveTo", point: [0, 0] },
									{ kind: "lineTo", point: [4, 4] },
								],
								blurPx: 10,
								paints: [
									{
										kind: "stroke",
										style: { kind: "solid", color: [1, 1, 1, 1] },
										composite: "source-over",
										opacity: 1,
										width: 2,
										cap: "butt",
										join: "miter",
									},
								],
							},
						],
					},
					{ kind: "releaseSurface", surface: "sky-night" },
				],
			},
		});
	}
	cancel(session: number) {
		if (!this.skyEntries.has(session)) return super.cancel(session);
		this.cancelled.push(session);
		return this.skyEntries.delete(session);
	}
}

test("Gather/Sun character binding survives snapshot mutation and rejects substitution", async () => {
	for (const substitute of [false, true]) {
		const owner = new FakeOwner(),
			character = named("character"),
			background = named("background");
		if (substitute)
			owner.manifestMutation = (v) => {
				v.identity.character = { substituted: true };
			};
		const pending = createHeartOwnerProvider({
			owner,
			source: source(),
			character,
			background,
			ceilingBytes: 64 * 1024 * 1024,
			capabilityJson,
			createBitmap: async () => bitmap(),
		});
		character.rgba.fill(0);
		new Uint8Array(character.encoded).fill(0);
		if (substitute) await expect(pending).rejects.toThrow("identity mismatch");
		else {
			const provider = await pending;
			expect(provider.providerSnapshotBytes).toBe(21);
			expect(provider.identity.character?.source.id).toBe("character");
			for (const kind of ["heartGather", "sunBloom"])
				expect(
					provider.frame({
						scene: { kind, settings: { heart: "heart", char: "character" } },
					}).identity,
				).toEqual(provider.identity);
			expect(owner.extractions).toBe(1);
			provider.dispose();
		}
		expect(owner.cancelled).toEqual([1]);
	}
});

test("Sky uses its dedicated producer, admits no crops and reuses the lease over seeks", async () => {
	const owner = new SkyOwner();
	const independent = await createHeartOwnerProvider({
		owner,
		source: source(),
		ceilingBytes: 64 * 1024 * 1024,
		capabilityJson,
		createBitmap: async () => bitmap(),
	});
	let uploads = 0;
	const sky = { bg: "sky", char: "character", seed: 3913 };
	const provider = await createHeartOwnerProvider({
		owner,
		source: named("sky"),
		character: named("character"),
		sky,
		ceilingBytes: 256 * 1024 * 1024,
		capabilityJson,
		createBitmap: async () => {
			uploads++;
			return bitmap();
		},
	});
	for (let i = 0; i < 3; i++) {
		const frame = provider.frame({
			scene: { kind: "skyShatter", settings: sky },
			songTicks: i,
		});
		expect("kind" in frame && frame.kind).toBe("skyShatter");
		expect(frame.plan.commands[0]!.kind).toBe("surface");
	}
	expect(uploads).toBe(0);
	expect(owner.extractions).toBe(1);
	provider.dispose();
	expect(owner.skyEntries.size).toBe(0);
	expect(owner.entries.has(independent.session)).toBe(true);
	independent.dispose();
	expect(owner.cancelled).toEqual([2, 1]);
});

test("Sky substituted native binding/settings/manifest or Heart frame variant revoke only that lease", async () => {
	for (const mutation of [
		"binding",
		"character",
		"settings",
		"hash",
		"frame",
	]) {
		const owner = new SkyOwner();
		if (mutation !== "frame")
			owner.mutateSky = (identity) => {
				if (mutation === "hash")
					Object.assign(identity, { imagesManifestSha256: "0".repeat(64) });
				else
					Object.assign(
						identity[
							mutation === "binding"
								? "binding"
								: mutation === "character"
									? "character"
									: "settings"
						],
						{ substituted: true },
					);
			};
		const pending = createHeartOwnerProvider({
			owner,
			source: named("sky"),
			character: named("character"),
			sky: { bg: "sky", char: "character" },
			ceilingBytes: 256 * 1024 * 1024,
			capabilityJson,
			createBitmap: async () => bitmap(),
		});
		if (mutation === "frame") {
			const provider = await pending;
			owner.badSkyFrame = true;
			expect(() => provider.frame({})).toThrow();
		} else await expect(pending).rejects.toThrow();
		expect(owner.skyEntries.size).toBe(0);
		expect(owner.cancelled).toEqual([1]);
	}
});

test("Sky abort drains manifest digest before cancellation and does not allocate a crop upload", async () => {
	const owner = new SkyOwner(),
		controller = new AbortController();
	let resume: () => void = () => {},
		entered: () => void = () => {};
	const barrier = new Promise<void>((resolve) => {
		resume = resolve;
	});
	const started = new Promise<void>((resolve) => {
		entered = resolve;
	});
	let calls = 0,
		uploads = 0;
	const digest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
	const pending = createHeartOwnerProvider({
		owner,
		source: named("sky"),
		character: named("character"),
		sky: { bg: "sky", char: "character" },
		ceilingBytes: 256 * 1024 * 1024,
		capabilityJson,
		signal: controller.signal,
		nativeWebCrypto: {
			subtle: {
				digest: async (...args: Parameters<SubtleCrypto["digest"]>) => {
					if (++calls === 5) {
						entered();
						await barrier;
					}
					return digest(...args);
				},
			},
		},
		createBitmap: async () => {
			uploads++;
			return bitmap();
		},
	});
	await started;
	controller.abort();
	expect(owner.skyEntries.size).toBe(1);
	expect(owner.cancelled).toEqual([]);
	resume();
	await expect(pending).rejects.toThrow();
	expect(owner.skyEntries.size).toBe(0);
	expect(owner.cancelled).toEqual([1]);
	expect(uploads).toBe(0);
});
