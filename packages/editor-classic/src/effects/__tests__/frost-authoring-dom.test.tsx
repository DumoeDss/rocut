import { expect, mock, test } from "bun:test";
import { createRequire } from "node:module";
import { mediaTime } from "@opencut/editor-contracts";
import type { ParamDefinition, ParamValues, ParamValue } from "../../params";
import type { EffectElement } from "../../timeline";

const require = createRequire(import.meta.url);
const dependencyRoot = process.env.FROST_UI_TEST_DEPENDENCIES;
const { JSDOM } = require(
	require.resolve("jsdom", {
		paths: dependencyRoot ? [dependencyRoot] : [process.cwd()],
	}),
);
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/",
});
for (const key of [
	"window",
	"document",
	"navigator",
	"Node",
	"Element",
	"HTMLElement",
	"HTMLInputElement",
	"Event",
	"MouseEvent",
	"getComputedStyle",
])
	Reflect.set(globalThis, key, dom.window[key]);
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const { createRoot } = await import("react-dom/client");
const { act } = await import("react");

const optics = [
	"amount",
	"coverage",
	"scale",
	"blur",
	"refraction",
	"tintStrength",
	"tintR",
	"tintG",
	"tintB",
];
const strokeFields = [
	"TimeTicks",
	"FromX",
	"FromY",
	"ToX",
	"ToY",
	"Radius",
	"Strength",
];
const definitions: ParamDefinition[] = [
	{
		key: "strokeCount",
		label: "Count",
		type: "number",
		min: 0,
		max: 16,
		step: 1,
		default: 0,
		keyframable: false,
	},
	...["holdTicks", "recoveryTicks", "seed"].map((key) => ({
		key,
		label: key,
		type: "number" as const,
		min: 0,
		max: 120000,
		step: 1,
		default: 1,
		keyframable: false,
	})),
	...optics.map((key) => ({
		key,
		label: key,
		type: "number" as const,
		min: 0,
		max: 1,
		step: 0.01,
		default: 0.5,
		keyframable: true,
	})),
	...Array.from({ length: 16 }, (_, index) =>
		strokeFields.map((field) => ({
			key: `stroke${index}${field}`,
			label: `stroke${index}${field}`,
			type: "number" as const,
			min: 0,
			max: 120000,
			step: 0.001,
			default: 0.5,
			required: false,
			keyframable: false,
		})),
	).flat(),
];

// Editor/catalog/playhead/keyframe observations are transport doubles; no Rust
// animation evaluation or admission is exercised. Actual Frost inputs, toggle,
// EffectParamField, drafts and shared save logic run in React DOM. Run alone.
let previewTracks: unknown = null;
let discarded = 0;
let renderPanel = () => {};
let toggleFails = false;
let keyframeActive = false;
const upserts: { value: ParamValue; time: number; propertyPath: string }[] = [];
const removals: { keyframeId: string }[] = [];
mock.module("../../editor/use-editor", () => ({
	useEditorInstance: () => ({
		timeline: {
			getPreviewTracks: () => previewTracks,
			discardPreview: () => {
				previewTracks = null;
				discarded++;
			},
			upsertKeyframes: async ({ keyframes }: { keyframes: typeof upserts }) => {
				if (toggleFails) throw new Error("transport rejected");
				upserts.push(...keyframes);
				keyframeActive = true;
				renderPanel();
			},
			removeKeyframes: async ({
				keyframes,
			}: {
				keyframes: typeof removals;
			}) => {
				removals.push(...keyframes);
				keyframeActive = false;
				renderPanel();
			},
		},
	}),
}));
mock.module("../index", () => ({
	effectsRegistry: { get: () => ({ params: definitions }) },
}));
mock.module("../../timeline", () => ({
	findTrackInSceneTracks: ({ tracks }: { tracks: { elements: unknown[] }[] }) =>
		tracks[0],
}));
mock.module("../../animation", () => ({
	buildGraphicParamPath: ({ paramKey }: { paramKey: string }) =>
		`params.${paramKey}`,
	buildEffectParamPath: ({
		effectId,
		paramKey,
	}: {
		effectId: string;
		paramKey: string;
	}) => `effects.${effectId}.${paramKey}`,
	resolveAnimationPathValueAtTime: ({
		fallbackValue,
	}: {
		fallbackValue: ParamValue;
	}) => fallbackValue,
}));
mock.module(
	"../../components/editor/panels/properties/hooks/use-element-playhead",
	() => ({
		useElementPlayhead: () => ({
			localTime: mediaTime({ ticks: 37 }),
			isPlayheadWithinElementRange: true,
		}),
	}),
);
mock.module(
	"../../components/editor/panels/properties/hooks/use-keyframed-param-property",
	() => ({
		useKeyframedParamProperty: () => ({
			hasAnimatedKeyframes: false,
			isKeyframedAtTime: keyframeActive,
			keyframeIdAtTime: keyframeActive ? "observed-keyframe" : null,
			onPreview: () => {},
		}),
	}),
);
// Numeric Frost controls never use this unrelated generic field branch.
mock.module(
	"../../components/editor/panels/properties/components/property-param-field",
	() => ({ PropertyParamField: () => null }),
);
mock.module("../components/bubble-trajectory-fields", () => ({
	BubbleTrajectoryFields: () => null,
}));
mock.module("../components/canvas-stroke-fields", () => ({
	CanvasStrokeFields: () => null,
}));
mock.module("../components/canvas-number-field", () => ({
	CanvasNumberField: () => null,
}));
const { EffectFields } = await import("../components/effect-fields");

test("real DOM Frost preserves optics/stroke precision and failed drafts; toggle emits exact transport", async () => {
	const initial: ParamValues = Object.fromEntries(
		definitions
			.filter((param) => param.required !== false)
			.map((param) => [param.key, param.default]),
	);
	let published = initial;
	let draft = initial;
	let succeeds = true;
	const attempts: ParamValues[] = [];
	const element: EffectElement = {
		id: "frost-element",
		type: "effect",
		name: "Frost",
		effectType: "frost",
		params: initial,
		startTime: mediaTime({ ticks: 0 }),
		duration: mediaTime({ ticks: 120000 }),
		trimStart: mediaTime({ ticks: 0 }),
		trimEnd: mediaTime({ ticks: 0 }),
	};
	const effect = {
		id: "frost-effect",
		type: "frost",
		enabled: true,
		params: initial,
	};
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	renderPanel = () =>
		root.render(
			<EffectFields
				effect={effect}
				element={element}
				trackId="track"
				params={published}
				previewParams={({ params }) => {
					draft = params;
					previewTracks = [{ elements: [{ ...element, params }] }];
					published = params;
					renderPanel();
				}}
				commit={async () => {
					attempts.push(structuredClone(draft));
					published = succeeds ? draft : initial;
					renderPanel();
					return succeeds;
				}}
			/>,
		);
	const input = (key: string) => {
		const node = container.querySelector<HTMLInputElement>(
			`[data-testid="effect-frost-input-${key}"]`,
		);
		if (!node) throw new Error(`Missing Frost input ${key}`);
		return node;
	};
	const edit = async ({ key, text }: { key: string; text: string }) => {
		const node = input(key);
		await act(async () => {
			node.focus();
		});
		await act(async () => {
			const setter = Object.getOwnPropertyDescriptor(
				dom.window.HTMLInputElement.prototype,
				"value",
			)?.set;
			if (!setter) throw new Error("DOM input setter unavailable");
			setter.call(node, text);
			node.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
		});
		await act(async () => {
			node.blur();
		});
	};
	const toggle = () => {
		const node = container.querySelector<HTMLButtonElement>(
			'button[title="Toggle amount keyframe"]',
		);
		if (!node) throw new Error("Missing amount toggle");
		return node;
	};
	try {
		await act(async () => {
			renderPanel();
		});
		expect(container.querySelectorAll("input")).toHaveLength(12);
		expect(container.querySelectorAll('button[title^="Toggle"]')).toHaveLength(
			9,
		);
		await edit({ key: "amount", text: "0.123456789012345" });
		expect(input("amount").value).toBe("0.123456789012345");
		expect(attempts.at(-1)?.amount).toBe(0.123456789012345);
		await act(async () => {
			toggle().click();
		});
		expect(upserts).toEqual([
			{
				trackId: "track",
				elementId: "frost-element",
				propertyPath: "params.amount",
				time: 37,
				value: 0.123456789012345,
			},
		]);
		expect(toggle().getAttribute("aria-pressed")).toBe("true");
		await act(async () => {
			toggle().click();
		});
		expect(removals[0]).toMatchObject({
			keyframeId: "observed-keyframe",
			propertyPath: "params.amount",
		});
		expect(toggle().getAttribute("aria-pressed")).toBe("false");
		toggleFails = true;
		await act(async () => {
			toggle().click();
		});
		expect(container.textContent).toContain("Keyframe was not saved");
		expect(input("amount").value).toBe("0.123456789012345");
		toggleFails = false;
		await act(async () => {
			container
				.querySelector<HTMLButtonElement>('[data-testid="effect-frost-add"]')
				?.click();
		});
		expect(attempts.at(-1)?.strokeCount).toBe(1);
		expect(container.querySelectorAll("input")).toHaveLength(19);
		await edit({ key: "stroke0TimeTicks", text: "37" });
		await edit({ key: "stroke0Radius", text: "0.0123456789012345" });
		expect(attempts.at(-1)).toMatchObject({
			stroke0TimeTicks: 37,
			stroke0Radius: 0.0123456789012345,
		});
		succeeds = false;
		await edit({ key: "amount", text: "1+2" });
		expect(attempts.at(-1)?.amount).toBe("1+2");
		expect(input("amount").value).toBe("1+2");
		expect(input("stroke0Radius").value).toBe("0.0123456789012345");
		expect(discarded).toBe(1);
		expect(toggle().disabled).toBe(true);
		expect(container.textContent).toContain("Unsaved inputs are shown below");
		succeeds = true;
		await edit({ key: "holdTicks", text: "41" });
		expect(attempts.at(-1)).toMatchObject({
			amount: "1+2",
			holdTicks: 41,
			stroke0TimeTicks: 37,
			stroke0Radius: 0.0123456789012345,
		});
		await edit({ key: "amount", text: "0.222222222222222" });
		expect(attempts.at(-1)?.amount).toBe(0.222222222222222);
		expect(toggle().disabled).toBe(false);
	} finally {
		await act(async () => {
			root.unmount();
		});
		container.remove();
	}
});
