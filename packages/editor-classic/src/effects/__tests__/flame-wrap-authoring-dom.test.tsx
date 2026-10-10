import { expect, mock, test } from "bun:test";
import { createRequire } from "node:module";
import { mediaTime } from "@opencut/editor-contracts";
import type { ParamDefinition, ParamValues, ParamValue } from "../../params";
import type { EffectElement } from "../../timeline";
import { flameWrapFieldGroups } from "../components/flame-wrap-field-groups";

const require = createRequire(import.meta.url);
const dependencyRoot = process.env.FLAME_WRAP_UI_TEST_DEPENDENCIES;
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

const definitions: ParamDefinition[] = [
	["amount", 0, 1, 0.01, 1],
	["boundaryWidth", 1, 32, 0.1, 8],
	["flameHeight", 1, 128, 0.1, 32],
	["flameOpacity", 0, 1, 0.01, 0.85],
	["sparkOpacity", 0, 1, 0.01, 0.6],
	["refraction", 0, 16, 0.1, 2],
	["speed", 0, 4, 0.01, 1],
	["wind", -1, 1, 0.01, 0],
	["seed", 0, 65535, 1, 0],
].map(([key, min, max, step, value]) => ({
	key: String(key),
	label: String(key),
	type: "number",
	min: Number(min),
	max: Number(max),
	step: Number(step),
	default: Number(value),
	keyframable: key !== "speed" && key !== "seed",
}));

// Editor/catalog/playhead and keyframe availability are explicit transport
// observations. Real EffectFields/EffectParamField/raw number inputs/toggle and
// save-retention run in React DOM; Rust/Host/history are not exercised. Run alone.
let previewTracks: unknown = null;
let discarded = 0;
let renderPanel = () => {};
let keyframeActive = false;
const upserts: { value: ParamValue; time: number; propertyPath: string }[] = [];
mock.module("../../editor/use-editor", () => ({
	useEditorInstance: () => ({
		timeline: {
			getPreviewTracks: () => previewTracks,
			discardPreview: () => {
				previewTracks = null;
				discarded++;
			},
			upsertKeyframes: async ({ keyframes }: { keyframes: typeof upserts }) => {
				upserts.push(...keyframes);
				keyframeActive = true;
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
		useKeyframedParamProperty: ({
			propertyPath,
		}: {
			propertyPath: string;
		}) => ({
			hasAnimatedKeyframes: false,
			isKeyframedAtTime:
				keyframeActive && propertyPath === "params.boundaryWidth",
			keyframeIdAtTime:
				keyframeActive && propertyPath === "params.boundaryWidth"
					? "observed-keyframe"
					: null,
			onPreview: () => {},
		}),
	}),
);
// Only unrelated control branches are excluded; Flame Wrap uses the existing
// raw numeric field and actual KeyframeToggle.
mock.module(
	"../../components/editor/panels/properties/components/property-param-field",
	() => ({ PropertyParamField: () => null }),
);
mock.module("../components/bubble-trajectory-fields", () => ({
	BubbleTrajectoryFields: () => null,
}));
mock.module("../components/frost-stroke-fields", () => ({
	FrostStrokeFields: () => null,
}));
mock.module("../components/canvas-stroke-fields", () => ({
	CanvasStrokeFields: () => null,
}));
mock.module("../components/canvas-number-field", () => ({
	CanvasNumberField: () => null,
}));
const { EffectFields } = await import("../components/effect-fields");

test("nine Flame Wrap controls group without altering descriptors or enabling speed/seed animation", () => {
	const before = structuredClone(definitions);
	const groups = flameWrapFieldGroups({ definitions });
	expect(groups.map((group) => group.label)).toEqual([
		"Boundary",
		"Optics",
		"Timing and seed",
	]);
	expect(groups.map((group) => group.params.map((param) => param.key))).toEqual(
		[
			["amount", "boundaryWidth", "flameHeight"],
			["flameOpacity", "sparkOpacity", "refraction"],
			["speed", "wind", "seed"],
		],
	);
	expect(definitions).toEqual(before);
});

test("real DOM Flame Wrap preserves pixel fractions, zero speed and invalid seed drafts through failed save/resubmit", async () => {
	const initial: ParamValues = Object.fromEntries(
		definitions.map((param) => [param.key, param.default]),
	);
	let published = initial,
		draft = initial,
		succeeds = true;
	const attempts: ParamValues[] = [];
	const element: EffectElement = {
		id: "flame-wrap-element",
		type: "effect",
		name: "Flame Wrap",
		effectType: "flame-wrap",
		params: initial,
		startTime: mediaTime({ ticks: 0 }),
		duration: mediaTime({ ticks: 120000 }),
		trimStart: mediaTime({ ticks: 0 }),
		trimEnd: mediaTime({ ticks: 0 }),
	};
	const effect = {
		id: "flame-wrap-effect",
		type: "flame-wrap",
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
			`input[aria-label="${key}"]`,
		);
		if (!node) throw new Error(`Missing Flame Wrap input ${key}`);
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
			'button[title="Toggle boundarywidth keyframe"]',
		);
		if (!node) throw new Error("Missing boundary toggle");
		return node;
	};
	try {
		await act(async () => {
			renderPanel();
		});
		expect(
			Array.from(container.querySelectorAll("h4"), (node) => node.textContent),
		).toEqual(["Boundary", "Optics", "Timing and seed"]);
		expect(container.querySelectorAll("input")).toHaveLength(9);
		expect(container.querySelectorAll('button[title^="Toggle"]')).toHaveLength(
			7,
		);
		expect(
			container.querySelector('button[title="Toggle speed keyframe"]'),
		).toBeNull();
		expect(
			container.querySelector('button[title="Toggle seed keyframe"]'),
		).toBeNull();
		await edit({ key: "boundaryWidth", text: "8.12345678901234" });
		await edit({ key: "flameHeight", text: "32.33333333333333" });
		await edit({ key: "refraction", text: "0.0123456789012345" });
		expect(attempts.at(-1)).toMatchObject({
			boundaryWidth: 8.12345678901234,
			flameHeight: 32.33333333333333,
			refraction: 0.0123456789012345,
		});
		expect(input("boundaryWidth").value).toBe("8.12345678901234");
		await act(async () => {
			toggle().click();
		});
		expect(upserts).toEqual([
			{
				trackId: "track",
				elementId: "flame-wrap-element",
				propertyPath: "params.boundaryWidth",
				time: 37,
				value: 8.12345678901234,
			},
		]);
		expect(toggle().getAttribute("aria-pressed")).toBe("true");
		await edit({ key: "speed", text: "0" });
		await edit({ key: "amount", text: "0" });
		expect(attempts.at(-1)).toMatchObject({ speed: 0, amount: 0 });
		succeeds = false;
		await edit({ key: "seed", text: "17.25" });
		expect(attempts.at(-1)?.seed).toBe(17.25);
		expect(input("seed").value).toBe("17.25");
		expect(input("speed").value).toBe("0");
		expect(input("boundaryWidth").value).toBe("8.12345678901234");
		expect(discarded).toBe(1);
		expect(toggle().disabled).toBe(true);
		expect(container.textContent).toContain("Unsaved inputs are shown below");
		await edit({ key: "refraction", text: "1+2" });
		expect(input("refraction").value).toBe("1+2");
		expect(attempts.at(-1)?.refraction).toBe("1+2");
		succeeds = true;
		await edit({ key: "wind", text: "-0.123456789012345" });
		expect(attempts.at(-1)).toMatchObject({
			seed: 17.25,
			refraction: "1+2",
			speed: 0,
			amount: 0,
			boundaryWidth: 8.12345678901234,
			wind: -0.123456789012345,
		});
		await edit({ key: "seed", text: "17" });
		await edit({ key: "refraction", text: "0" });
		expect(attempts.at(-1)).toMatchObject({
			seed: 17,
			refraction: 0,
			speed: 0,
			amount: 0,
		});
		expect(toggle().disabled).toBe(false);
	} finally {
		await act(async () => {
			root.unmount();
		});
		container.remove();
	}
});
