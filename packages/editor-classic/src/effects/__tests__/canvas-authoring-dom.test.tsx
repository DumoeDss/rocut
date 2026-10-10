import { expect, mock, test } from "bun:test";
import { createRequire } from "node:module";
import { mediaTime } from "@opencut/editor-contracts";
import type { ParamDefinition, ParamValues } from "../../params";
import type { EffectElement } from "../../timeline";

const require = createRequire(import.meta.url);
const dependencyRoot = process.env.CANVAS_UI_TEST_DEPENDENCIES;
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

const staticKeys = [
	"version",
	"columns",
	"rows",
	"durationTicks",
	"seed",
	"drying",
	"diffusion",
	"weaveFrequency",
	"weaveHeight",
	"lightX",
	"lightY",
	"lightZ",
	"relief",
];
const fields = [
	"StartTicks",
	"EndTicks",
	"FromX",
	"FromY",
	"ToX",
	"ToY",
	"Radius",
	"Bristles",
	"Opacity",
	"Wetness",
	"Thickness",
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
	...staticKeys.map((key) => ({
		key,
		label: key,
		type: "number" as const,
		min: 0,
		max: 120000,
		step: 0.01,
		default: 1,
		keyframable: false,
	})),
	...Array.from({ length: 16 }, (_, index) =>
		fields.map((field, axis) => ({
			key: `stroke${index}${field}`,
			label: `stroke${index}${field}`,
			type: "number" as const,
			min: 0,
			max: 120000,
			step: 0.001,
			default: axis + 1,
			keyframable: false,
			required: false,
		})),
	).flat(),
];

// Editor/session/catalog transport is doubled; unrelated effect branches are
// excluded. Inputs, React DOM, property drafts, Canvas controls and shared
// save/retention code run unchanged. This test runs in its own Bun process.
let previewTracks: unknown = null;
let discarded = 0;
mock.module("../../editor/use-editor", () => ({
	useEditorInstance: () => ({
		timeline: {
			getPreviewTracks: () => previewTracks,
			discardPreview: () => {
				previewTracks = null;
				discarded++;
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
mock.module("../components/effect-param-field", () => ({
	EffectParamField: () => null,
}));
mock.module("../components/frost-number-field", () => ({
	FrostNumberField: () => null,
}));
mock.module("../components/frost-stroke-fields", () => ({
	FrostStrokeFields: () => null,
}));
mock.module("../components/bubble-trajectory-fields", () => ({
	BubbleTrajectoryFields: () => null,
}));
const { EffectFields } = await import("../components/effect-fields");

test("real DOM Canvas inputs preserve precise edits, retain failed complete drafts and support Add/Clear", async () => {
	const initial: ParamValues = Object.fromEntries(
		staticKeys.map((key) => [key, 1]),
	);
	initial.strokeCount = 0;
	let published = initial;
	let draft = initial;
	let succeeds = true;
	const attempts: ParamValues[] = [];
	const element: EffectElement = {
		id: "canvas-element",
		type: "effect",
		name: "Canvas",
		effectType: "canvas",
		params: initial,
		startTime: mediaTime({ ticks: 0 }),
		duration: mediaTime({ ticks: 120000 }),
		trimStart: mediaTime({ ticks: 0 }),
		trimEnd: mediaTime({ ticks: 0 }),
	};
	const effect = {
		id: "canvas-effect",
		type: "canvas",
		enabled: true,
		params: initial,
	};
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	const render = () =>
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
					render();
				}}
				commit={async () => {
					attempts.push(structuredClone(draft));
					if (succeeds) published = draft;
					else published = initial;
					render();
					return succeeds;
				}}
			/>,
		);
	const input = (key: string) => {
		const node = container.querySelector<HTMLInputElement>(
			`[data-testid="effect-canvas-input-${key}"]`,
		);
		if (!node) throw new Error(`Missing Canvas input ${key}`);
		return node;
	};
	const click = async (id: string) => {
		const node = container.querySelector<HTMLButtonElement>(
			`[data-testid="${id}"]`,
		);
		if (!node) throw new Error(`Missing Canvas button ${id}`);
		await act(async () => {
			node.click();
		});
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
	try {
		await act(async () => {
			render();
		});
		expect(container.querySelectorAll("input")).toHaveLength(13);
		published = { ...published, strokeCount: "bad", stroke15Radius: 0.1 };
		await act(async () => {
			render();
		});
		expect(container.textContent).toContain("Invalid trajectory count");
		expect(
			container.querySelector<HTMLButtonElement>(
				"[data-testid=effect-canvas-add]",
			)?.disabled,
		).toBe(true);
		await click("effect-canvas-clear");
		expect(attempts.at(-1)?.strokeCount).toBe(0);
		expect(Object.hasOwn(attempts.at(-1) ?? {}, "stroke15Radius")).toBe(false);
		await edit({ key: "drying", text: "0.123456789012345" });
		expect(attempts.at(-1)?.drying).toBe(0.123456789012345);
		expect(input("drying").value).toBe("0.123456789012345");
		await click("effect-canvas-add");
		expect(attempts.at(-1)?.strokeCount).toBe(1);
		expect(container.querySelectorAll("input")).toHaveLength(24);
		await edit({ key: "stroke0StartTicks", text: "37" });
		expect(attempts.at(-1)?.stroke0StartTicks).toBe(37);
		await edit({ key: "stroke0FromX", text: "0.333333333333333" });
		expect(attempts.at(-1)?.stroke0FromX).toBe(0.333333333333333);
		succeeds = false;
		await edit({ key: "stroke0Radius", text: "bad" });
		expect(discarded).toBe(1);
		expect(container.textContent).toContain("Unsaved inputs are shown below");
		expect(input("stroke0Radius").value).toBe("bad");
		expect(input("stroke0StartTicks").value).toBe("37");
		expect(input("drying").value).toBe("0.123456789012345");
		succeeds = true;
		await edit({ key: "lightX", text: "0.777777777777777" });
		expect(attempts.at(-1)).toMatchObject({
			strokeCount: 1,
			stroke0Radius: "bad",
			stroke0StartTicks: 37,
			drying: 0.123456789012345,
			lightX: 0.777777777777777,
		});
		await edit({ key: "stroke0Radius", text: "0.0123456789012345" });
		expect(attempts.at(-1)?.stroke0Radius).toBe(0.0123456789012345);
		await click("effect-canvas-clear");
		expect(attempts.at(-1)?.strokeCount).toBe(0);
		expect(
			Object.keys(attempts.at(-1) ?? {}).some((key) => /^stroke\d/.test(key)),
		).toBe(false);
		expect(input("drying").value).toBe("0.123456789012345");
		expect(container.querySelectorAll("input")).toHaveLength(13);
	} finally {
		await act(async () => {
			root.unmount();
		});
		container.remove();
	}
});
