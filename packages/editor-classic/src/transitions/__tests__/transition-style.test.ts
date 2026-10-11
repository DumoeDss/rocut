import { expect, test } from "bun:test";
import { isValidTransitionIn } from "@opencut/editor-contracts/engine/invariant";
import {
	clipId,
	revisionOf,
	type PeelTransitionStyle,
	type BendTransitionStyle,
} from "@opencut/editor-contracts";
import { roundMediaTime } from "../../wasm/media-time";
const mediaTime = ({ ticks }: { ticks: number }) =>
	roundMediaTime({ time: ticks });
import {
	validateNativeTransitionStyle,
	nativePeelDefaults,
	transitionStyleOf,
	PEEL_UNAVAILABLE,
	nativeBendDefaults,
	BEND_UNAVAILABLE,
} from "../transition-style";
import {
	projectFixture,
	storeFixture,
	TEST_PROJECT_ID,
} from "../../editor/transactions/opencut/__tests__/fixture";
import {
	encodeProject,
	decodeProject,
} from "../../editor/persistence/project-codec";
import { projectOpenCutDraft } from "../../editor/transactions/opencut/projection";
import {
	evaluateDocumentTransitions,
	openCutMediaPolicy,
} from "../../editor/transactions/opencut/media-policy";
import { createOpenCutTransactionDocumentAdapter } from "../../editor/transactions/opencut/adapter";
import { openTransactionEngine } from "@opencut/editor-contracts/engine";
import { inspectTransitionChoice } from "../transition-choice";

const style: PeelTransitionStyle = {
	kind: "peel",
	direction: "down",
	curl: 0.17,
	segments: 32,
	shading: 0.6,
	perspective: 0.5,
};
const transition = {
	...style,
	outgoingClipId: clipId("left"),
	durationFrames: 30,
};
const bend: BendTransitionStyle = {
	kind: "bend",
	direction: "up",
	hinge: 0.4,
	angle: 1.1,
	perspective: 0.5,
	shading: 0.7,
};
const bendTransition = {
	...bend,
	outgoingClipId: clipId("left"),
	durationFrames: 30,
};

test("Bend transport, catalog admission and response identity remain native and exact", () => {
	expect(isValidTransitionIn(bendTransition)).toBe(true);
	for (const invalid of [
		{ ...bendTransition, hinge: NaN },
		{ ...bendTransition, angle: Infinity },
		{ ...bendTransition, direction: "diagonal" },
		{ ...bendTransition, extra: 1 },
		{ ...bendTransition, angle: undefined },
	])
		expect(isValidTransitionIn(invalid)).toBe(false);
	expect(
		isValidTransitionIn({ ...bendTransition, hinge: -100, angle: 999 }),
	).toBe(true);
	let input: unknown;
	const parameters = Object.fromEntries(
		Object.entries(bend)
			.filter(([key]) => key !== "kind")
			.map(([key, value]) => [key, { suggested: value }]),
	);
	const core = {
		nativeTransitionStyleValidateJson: (text: string) => {
			input = JSON.parse(text);
			return text;
		},
		mvRecipeCatalogJson: () =>
			JSON.stringify({ transitionParameters: { bend: { parameters } } }),
	};
	expect(nativeBendDefaults(core)).toEqual({ style: bend });
	expect(input).toEqual(bend);
	expect(
		nativeBendDefaults({ mvRecipeCatalogJson: core.mvRecipeCatalogJson }),
	).toEqual({ error: BEND_UNAVAILABLE });
	expect(transitionStyleOf(bendTransition)).toEqual(bend);
	expect(() => validateNativeTransitionStyle(bend, {})).toThrow(
		BEND_UNAVAILABLE,
	);
	expect(() =>
		validateNativeTransitionStyle(bend, {
			nativeTransitionStyleValidateJson: () => JSON.stringify(style),
		}),
	).toThrow("Invalid native Bend validation response");
	expect(() =>
		validateNativeTransitionStyle(style, {
			nativeTransitionStyleValidateJson: () => JSON.stringify(bend),
		}),
	).toThrow("Invalid native Peel validation response");
});

test("Peel transition transport is exact and structural only; old cross dissolve remains identical", () => {
	expect(isValidTransitionIn(transition)).toBe(true);
	expect(
		isValidTransitionIn({
			kind: "cross-dissolve",
			outgoingClipId: "left",
			durationFrames: 30,
		}),
	).toBe(true);
	for (const value of [
		{ ...transition, unknown: true },
		{ ...transition, direction: "diagonal" },
		{ ...transition, segments: 2.5 },
		{ ...transition, segments: 4294967296 },
		{ ...transition, curl: NaN },
		{ ...transition, shading: Infinity },
		{ ...transition, durationFrames: 1 },
		{ ...transition, outgoingClipId: "" },
		{ kind: "peel", outgoingClipId: "left", durationFrames: 30 },
	])
		expect(isValidTransitionIn(value)).toBe(false);
	// These values are transport-valid; only the native style seam decides range legality.
	expect(
		isValidTransitionIn({
			...transition,
			curl: 100,
			segments: 7,
			perspective: -1,
		}),
	).toBe(true);
});

test("thin style bridge delegates complete values and fails closed with old or malformed cores", () => {
	let input: unknown;
	const core = {
		nativeTransitionStyleValidateJson(text: string) {
			input = JSON.parse(text);
			return text;
		},
	};
	expect(validateNativeTransitionStyle(style, core)).toEqual(style);
	expect(input).toEqual(style);
	expect(() => validateNativeTransitionStyle(style, {})).toThrow(
		PEEL_UNAVAILABLE,
	);
	expect(validateNativeTransitionStyle({ kind: "cross-dissolve" }, {})).toEqual(
		{ kind: "cross-dissolve" },
	);
	expect(() =>
		validateNativeTransitionStyle(style, {
			nativeTransitionStyleValidateJson() {
				throw Error("native parameter rejection");
			},
		}),
	).toThrow("native parameter rejection");
	for (const response of [
		"{}",
		'{"kind":"cross-dissolve"}',
		JSON.stringify({ ...style, extra: true }),
	])
		expect(() =>
			validateNativeTransitionStyle(style, {
				nativeTransitionStyleValidateJson: () => response,
			}),
		).toThrow("Invalid native Peel validation response");
	expect(transitionStyleOf(transition)).toEqual(style);
});

test("Peel UI suggestions come from the actual native catalog and require new runtime admission", () => {
	const parameters = Object.fromEntries(
		Object.entries(style)
			.filter(([key]) => key !== "kind")
			.map(([key, value]) => [key, { suggested: value }]),
	);
	const core = {
		nativeTransitionStyleValidateJson: (text: string) => text,
		mvRecipeCatalogJson: () =>
			JSON.stringify({ transitionParameters: { peel: { parameters } } }),
	};
	expect(nativePeelDefaults(core)).toEqual({ style });
	expect(
		nativePeelDefaults({ mvRecipeCatalogJson: core.mvRecipeCatalogJson }).error,
	).toBe(PEEL_UNAVAILABLE);
	expect(
		nativePeelDefaults({ ...core, mvRecipeCatalogJson: () => "{}" }).style,
	).toBeUndefined();
});

test.each([
	[style, transition, PEEL_UNAVAILABLE],
	[bend, bendTransition, BEND_UNAVAILABLE],
] as const)(
	"full flattened native style survives encode, reopen and projection: %j",
	(style, transition, unavailable) => {
		const project = projectFixture(),
			main = project.scenes[0].tracks.main;
		const picture = {
			type: "image" as const,
			mediaId: "image",
			name: "picture",
			duration: mediaTime({ ticks: 240000 }),
			startTime: mediaTime({ ticks: 0 }),
			trimStart: mediaTime({ ticks: 0 }),
			trimEnd: mediaTime({ ticks: 0 }),
			params: {},
		};
		main.elements = [
			{ ...picture, id: "left" },
			{
				...picture,
				id: "right",
				startTime: mediaTime({ ticks: 240000 }),
				transitionIn: transition,
			},
		];
		const encoded = encodeProject({
			project,
			retained: { untouched: { value: true } },
		});
		const reopened = decodeProject(encoded);
		expect(reopened.scenes[0].tracks.main.elements).toEqual(main.elements);
		const document = projectOpenCutDraft(
			{
				project: reopened,
				assetCatalog: [{ id: "image", name: "image", type: "image" }],
			},
			{ revision: revisionOf(0), idempotency: [] },
		);
		expect(
			document.clips.find((clip) => clip.id === "right")?.transitionIn,
		).toEqual(transition);
		const original = structuredClone(document);
		// The checked-in runtime is intentionally old until a real WASM build is authorized.
		expect(() => evaluateDocumentTransitions({ document })).toThrow(
			unavailable,
		);
		expect(document).toEqual(original);
		const choice = inspectTransitionChoice({
			document,
			incomingId: "right",
			outgoingId: "left",
			durationFrames: 30,
			style,
		});
		expect(choice).toEqual({ valid: false, message: unavailable });
	},
);

test.each([
	[transition, PEEL_UNAVAILABLE],
	[bendTransition, BEND_UNAVAILABLE],
] as const)(
	"real agent transaction refuses unsupported native style atomically: %j",
	async (transition, unavailable) => {
		const project = projectFixture();
		const picture = {
			type: "image" as const,
			mediaId: "image",
			name: "picture",
			duration: mediaTime({ ticks: 240000 }),
			startTime: mediaTime({ ticks: 0 }),
			trimStart: mediaTime({ ticks: 0 }),
			trimEnd: mediaTime({ ticks: 0 }),
			params: {},
		};
		project.scenes[0].tracks.main.elements = [
			{ ...picture, id: "left" },
			{ ...picture, id: "right", startTime: mediaTime({ ticks: 240000 }) },
		];
		const f = await storeFixture(project),
			before = await f.store.load({ id: TEST_PROJECT_ID });
		if (!before) throw Error("missing fixture");
		const adapter = createOpenCutTransactionDocumentAdapter({
			initialRecord: before,
			initialAssets: [{ id: "image", name: "image", type: "image" }],
		});
		const engine = await openTransactionEngine({
			store: f.store,
			projectId: TEST_PROJECT_ID,
			documentAdapter: adapter,
			placementPolicies: [openCutMediaPolicy],
		});
		await expect(
			engine.apply({
				operations: [
					{
						kind: "update-clip",
						clipId: clipId("right"),
						patch: { transitionIn: transition },
					},
				],
			}),
		).rejects.toThrow(unavailable);
		expect(await f.store.load({ id: TEST_PROJECT_ID })).toEqual(before);
		expect(f.getSaveCount()).toBe(0);
		expect(
			adapter.currentDraft().project.scenes[0].tracks.main.elements,
		).toEqual(project.scenes[0].tracks.main.elements);
	},
);
