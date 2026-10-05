import { describe, expect, test } from "bun:test";
import {
	assetId,
	mediaTime,
	motionTextCueId,
	motionTextCutId,
	motionTextFontId,
	motionTextSequenceId,
	type MotionTextSequence,
} from "@opencut/editor-contracts";

import {
	MotionTextFontRuntime,
	type MotionTextFontEnvironment,
	type MotionTextFontRuntimeOptions,
} from "../motion-text/font-runtime";

const FONT_DIGEST = "sha256:fixture-font";

function sequenceFixture({
	contentDigest = FONT_DIGEST,
}: {
	contentDigest?: string;
} = {}): MotionTextSequence {
	const fontId = motionTextFontId("font:project");
	const cueId = motionTextCueId("cue:font");
	const preset = {
		style: "base",
		layout: "center",
		enter: "cut",
		hold: "still",
		exit: "cut",
		decor: [],
		treat: "none",
		bg: "none",
		cam: "static",
		fx: [],
		trans: null,
	} as const;
	return {
		id: motionTextSequenceId("sequence:font-runtime"),
		schemaVersion: 1,
		revision: 1,
		source: { format: "plain", text: "Hello 世界" },
		language: "en",
		duration: mediaTime({ ticks: 120_000 }),
		compositionMode: "overlay",
		seed: 9,
		engine: {
			id: "jizura",
			version: "0.9.0",
			catalogHash: "font-runtime-fixture",
			plannerVersion: 1,
			tokenizerVersion: "unicode-v1",
		},
		fonts: [
			{
				id: fontId,
				source: "project",
				family: "Fixture Sans",
				style: "normal",
				weight: 700,
				assetId: assetId("asset:font"),
				contentDigest,
			},
		],
		defaults: {
			preset,
			fontId,
			colors: {},
			parameters: {},
		},
		cues: [
			{
				id: cueId,
				text: "Hello 世界",
				startTime: mediaTime({ ticks: 0 }),
				duration: mediaTime({ ticks: 120_000 }),
				interlude: false,
				gapBefore: false,
				impact: false,
				emphasis: [],
				segments: ["Hello", "世界"],
				locks: [],
				overrides: {},
			},
		],
		resolvedPlan: {
			version: 1,
			sequenceRevision: 1,
			cuts: [
				{
					id: motionTextCutId("cut:font"),
					cueId,
					text: "Hello 世界",
					startTime: mediaTime({ ticks: 0 }),
					duration: mediaTime({ ticks: 120_000 }),
					seed: 9,
					preset,
					fontId,
					parameters: {},
				},
			],
		},
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((next) => {
		resolve = next;
	});
	return { promise, resolve };
}

function runtimeFixture({
	loadProjectFont,
	missingCodePoints = [],
	inspectCoverage,
}: {
	loadProjectFont?: (args: {
		signal: AbortSignal;
	}) => Promise<ArrayBuffer | null>;
	missingCodePoints?: readonly number[];
	inspectCoverage?: MotionTextFontRuntimeOptions["inspectCoverage"];
} = {}) {
	let loads = 0;
	let faceLoads = 0;
	let adds = 0;
	let deletes = 0;
	const inspectedTexts: string[] = [];
	const environment: MotionTextFontEnvironment = {
		async loadSystemFont() {},
		async loadFontFace({ family }) {
			faceLoads += 1;
			return { family, native: null };
		},
		addFontFace() {
			adds += 1;
		},
		deleteFontFace() {
			deletes += 1;
		},
	};
	const runtime = new MotionTextFontRuntime({
		environment,
		inspectCoverage,
		inspectFont: ({ text }) => {
			inspectedTexts.push(text);
			return {
				error: null,
				inspection: {
					contentDigest: FONT_DIGEST,
					faceIndex: 0,
					glyphCount: 10,
					missingCodePoints: text.length === 0 ? [] : missingCodePoints,
				},
			};
		},
		loadBuiltinFont: async () => new Uint8Array([1]).buffer,
		loadProjectFont: async ({ signal }) => {
			loads += 1;
			return loadProjectFont
				? loadProjectFont({ signal })
				: new Uint8Array([1, 2, 3]).buffer;
		},
	});
	return {
		runtime,
		counts: () => ({ loads, faceLoads, adds, deletes }),
		inspectedTexts,
	};
}

describe("MotionTextFontRuntime", () => {
	test("digests immutable bytes once but checks every changed text and revalidates after invalidation", async () => {
		const checkedTexts: string[] = [];
		const fixture = runtimeFixture({
			inspectCoverage: ({ text }) => {
				checkedTexts.push(text);
				return {
					error: null,
					inspection: {
						faceIndex: 0,
						glyphCount: 10,
						missingCodePoints: text === "missing" ? [0x10ffff] : [],
					},
				};
			},
		});
		const base = sequenceFixture();
		const prepare = ({
			text,
			purpose,
		}: {
			text: string;
			purpose: "preview" | "export";
		}) =>
			fixture.runtime.prepareSequence({
				projectId: "project",
				purpose,
				sequence: {
					...base,
					resolvedPlan: base.resolvedPlan && {
						...base.resolvedPlan,
						cuts: base.resolvedPlan.cuts.map((cut) => ({ ...cut, text })),
					},
				},
			});
		expect(
			(await prepare({ text: "first", purpose: "preview" })).diagnostics,
		).toEqual([]);
		expect(
			(await prepare({ text: "second", purpose: "preview" })).diagnostics,
		).toEqual([]);
		expect(
			(await prepare({ text: "missing", purpose: "export" })).diagnostics,
		).toContainEqual(
			expect.objectContaining({
				code: "missing-glyph",
				severity: "error",
				codePoints: [0x10ffff],
			}),
		);
		expect(fixture.inspectedTexts).toEqual([""]);
		expect(checkedTexts).toEqual(["first", "second", "missing"]);
		fixture.runtime.invalidate();
		await prepare({ text: "first", purpose: "export" });
		expect(fixture.inspectedTexts).toEqual(["", ""]);
		expect(fixture.counts()).toMatchObject({ loads: 2, adds: 2, deletes: 1 });
		fixture.runtime.dispose();
	});

	test("coverage cannot bypass digest validation on a replaced font", async () => {
		let coverageCalls = 0;
		const fixture = runtimeFixture({
			inspectCoverage: () => {
				coverageCalls += 1;
				return {
					error: null,
					inspection: { faceIndex: 0, glyphCount: 1, missingCodePoints: [] },
				};
			},
		});
		const result = await fixture.runtime.prepareSequence({
			projectId: "project",
			purpose: "export",
			sequence: sequenceFixture({ contentDigest: "sha256:changed" }),
		});
		expect(result.diagnostics).toContainEqual(
			expect.objectContaining({
				code: "font-digest-mismatch",
				severity: "error",
			}),
		);
		expect(coverageCalls).toBe(0);
		expect(fixture.counts().faceLoads).toBe(0);
		fixture.runtime.dispose();
	});
	test("caches failures between frames but recovers on an explicit export attempt", async () => {
		let available = false;
		const fixture = runtimeFixture({
			loadProjectFont: async () =>
				available ? new Uint8Array([1, 2, 3]).buffer : null,
		});
		const prepare = (purpose: "preview" | "export") =>
			fixture.runtime.prepareSequence({
				projectId: "project",
				purpose,
				sequence: sequenceFixture(),
			});
		const failed = await prepare("export");
		expect(failed.diagnostics).toContainEqual(
			expect.objectContaining({ severity: "error", code: "font-load-failed" }),
		);
		available = true;
		for (let index = 0; index < 20; index += 1) await prepare("preview");
		expect(fixture.counts().loads).toBe(1);
		fixture.runtime.retryFailedLoads();
		const restored = await prepare("export");
		expect(restored.diagnostics).toEqual([]);
		expect(restored.fonts.has("font:project")).toBe(true);
		expect(restored.generation).toBe(failed.generation + 1);
		expect(fixture.counts()).toMatchObject({ loads: 2, adds: 1 });
		fixture.runtime.retryFailedLoads();
		await prepare("export");
		expect(fixture.runtime.inspect().generation).toBe(restored.generation);
		expect(fixture.counts()).toMatchObject({ loads: 2, adds: 1, deletes: 0 });
		fixture.runtime.dispose();
		expect(() => fixture.runtime.retryFailedLoads()).toThrow(/disposed/);
	});

	test("does not let stale failed loads invalidate a healthy replacement generation", async () => {
		const old = deferred<ArrayBuffer | null>();
		let first = true;
		const fixture = runtimeFixture({
			loadProjectFont: async () => {
				if (first) {
					first = false;
					return old.promise;
				}
				return new Uint8Array([1, 2, 3]).buffer;
			},
		});
		const prepare = () =>
			fixture.runtime.prepareSequence({
				projectId: "project",
				purpose: "export",
				sequence: sequenceFixture(),
			});
		const stale = prepare();
		const rejected = stale.catch((error: unknown) => error);
		fixture.runtime.invalidate();
		const healthy = await prepare();
		old.resolve(null);
		expect(String(await rejected)).toMatch(/stale/i);
		fixture.runtime.retryFailedLoads();
		expect(fixture.runtime.inspect().generation).toBe(healthy.generation);
		expect(fixture.counts()).toMatchObject({ loads: 2, adds: 1, deletes: 0 });
	});

	test("waits for bytes and FontFace registration before publishing a font", async () => {
		const bytes = deferred<ArrayBuffer | null>();
		const fixture = runtimeFixture({
			loadProjectFont: () => bytes.promise,
		});
		const preparation = fixture.runtime.prepareSequence({
			projectId: "project",
			purpose: "preview",
			sequence: sequenceFixture(),
		});
		await Promise.resolve();

		expect(fixture.runtime.inspect()).toMatchObject({
			pendingLoads: 1,
			loadedFaces: 0,
		});
		bytes.resolve(new Uint8Array([1, 2, 3]).buffer);
		const prepared = await preparation;

		expect(prepared.diagnostics).toEqual([]);
		expect(prepared.fonts.get("font:project")?.family).toMatch(/^__rocut_mt_/);
		expect(fixture.inspectedTexts).toEqual(["", "Hello 世界"]);
		expect(fixture.runtime.inspect()).toMatchObject({
			cachedFonts: 1,
			pendingLoads: 0,
			loadedFaces: 1,
		});
	});

	test("reports exact missing code points and fails export closed", async () => {
		const fixture = runtimeFixture({ missingCodePoints: [0x4e16, 0x754c] });
		const preview = await fixture.runtime.prepareSequence({
			projectId: "project",
			purpose: "preview",
			sequence: sequenceFixture(),
		});
		const exported = await fixture.runtime.prepareSequence({
			projectId: "project",
			purpose: "export",
			sequence: sequenceFixture(),
		});

		expect(preview.diagnostics).toContainEqual(
			expect.objectContaining({
				severity: "warning",
				code: "missing-glyph",
				codePoints: [0x4e16, 0x754c],
			}),
		);
		expect(preview.fonts.has("font:project")).toBe(true);
		expect(exported.diagnostics).toContainEqual(
			expect.objectContaining({ severity: "error", code: "missing-glyph" }),
		);
		expect(exported.fonts.has("font:project")).toBe(false);
	});

	test("rejects digest mismatches before registering a face", async () => {
		const fixture = runtimeFixture();
		const prepared = await fixture.runtime.prepareSequence({
			projectId: "project",
			purpose: "export",
			sequence: sequenceFixture({ contentDigest: "sha256:wrong" }),
		});

		expect(prepared.diagnostics).toContainEqual(
			expect.objectContaining({
				severity: "error",
				code: "font-digest-mismatch",
			}),
		);
		expect(fixture.counts()).toMatchObject({ faceLoads: 0, adds: 0 });
	});

	test("drops a late load after invalidation and releases registered faces", async () => {
		const bytes = deferred<ArrayBuffer | null>();
		const fixture = runtimeFixture({
			loadProjectFont: () => bytes.promise,
		});
		const stale = fixture.runtime.prepareSequence({
			projectId: "project",
			purpose: "preview",
			sequence: sequenceFixture(),
		});
		await Promise.resolve();
		fixture.runtime.invalidate();
		bytes.resolve(new Uint8Array([1, 2, 3]).buffer);

		await expect(stale).rejects.toThrow(/stale/i);
		expect(fixture.runtime.inspect()).toMatchObject({
			cachedFonts: 0,
			loadedFaces: 0,
			pendingLoads: 0,
		});

		await fixture.runtime.prepareSequence({
			projectId: "project",
			purpose: "preview",
			sequence: sequenceFixture(),
		});
		fixture.runtime.dispose();
		expect(fixture.runtime.inspect()).toMatchObject({
			cachedFonts: 0,
			loadedFaces: 0,
			disposed: true,
		});
		expect(fixture.counts().deletes).toBe(1);
	});

	test("keeps font bytes and face slots bounded across long-song preparations", async () => {
		const fixture = runtimeFixture();
		for (let index = 0; index < 1_000; index += 1) {
			await fixture.runtime.prepareSequence({
				projectId: "project",
				purpose: "preview",
				sequence: sequenceFixture(),
			});
		}

		expect(fixture.counts()).toMatchObject({ loads: 1, faceLoads: 1, adds: 1 });
		expect(fixture.runtime.inspect()).toMatchObject({
			cachedFonts: 1,
			loadedFaces: 1,
			pendingLoads: 0,
		});
	});
});
