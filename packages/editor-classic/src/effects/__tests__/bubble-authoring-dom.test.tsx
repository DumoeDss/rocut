import { expect, mock, test } from "bun:test";
import { createRequire } from "node:module";
import { mediaTime } from "@opencut/editor-contracts";
import type { ParamDefinition, ParamValues } from "../../params";
import type { EffectElement } from "../../timeline";

const require = createRequire(import.meta.url);
const dependencyRoot = process.env.BUBBLE_UI_TEST_DEPENDENCIES;
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

// Frozen trajectory schema from rust/crates/effects/src/bubble/catalog.rs.
const definitions: ParamDefinition[] = [
	{
		key: "pointCount",
		label: "Trajectory points",
		type: "number",
		min: 1,
		max: 16,
		step: 1,
		default: 1,
		keyframable: false,
	},
	...Array.from({ length: 16 }, (_, index) =>
		["Time", "X", "Y"].map((axis) => ({
			key: `point${index}${axis}`,
			label: `point${index}${axis}`,
			type: "number" as const,
			min: axis === "Time" ? 0 : -1,
			max: axis === "Time" ? (index === 0 ? 0 : 3600000) : 2,
			step: axis === "Time" ? 1 : 0.001,
			default: axis === "Time" ? 0 : 0.5,
			keyframable: false,
			required: index === 0,
		})),
	).flat(),
];

// Only editor/catalog/transport and unrelated optics are doubled. React DOM,
// NumberField/PropertyParamField, BubbleTrajectoryFields and EffectFields'
// complete-draft save/retention run unchanged, in an isolated Bun process.
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
mock.module("../components/canvas-number-field", () => ({
	CanvasNumberField: () => null,
}));
mock.module("../components/canvas-stroke-fields", () => ({
	CanvasStrokeFields: () => null,
}));
mock.module("../../components/ui/color-picker", () => ({
	ColorPicker: () => null,
}));
mock.module("../../components/ui/select", () => ({
	Select: () => null,
	SelectContent: () => null,
	SelectItem: () => null,
	SelectTrigger: () => null,
	SelectValue: () => null,
}));
const { EffectFields } = await import("../components/effect-fields");

test("Bubble DOM Add/edit/remove atomically save full snapshots; rejected drafts survive and retry", async () => {
	const initial: ParamValues = {
		pointCount: 1,
		point0Time: 0,
		point0X: 0.25,
		point0Y: 0.45,
		durationTicks: 240000,
		amount: 0.73,
		refraction: -0.04,
		follow: 0.5,
	};
	const element: EffectElement = {
		id: "bubble-element",
		type: "effect",
		name: "Authored bubble",
		effectType: "bubble",
		params: initial,
		startTime: mediaTime({ ticks: 12000 }),
		duration: mediaTime({ ticks: 240000 }),
		trimStart: mediaTime({ ticks: 17 }),
		trimEnd: mediaTime({ ticks: 23 }),
		animations: {
			"params.amount": {
				keys: [
					{
						id: "retained-optic",
						time: mediaTime({ ticks: 37 }),
						value: 0.62,
						segmentToNext: "linear",
						tangentMode: "auto",
					},
				],
			},
		},
	};
	const source = {
		attachment: "unchanged-source",
		integrity: "unchanged-hash",
	};
	const neighbor = {
		id: "neighbor",
		params: { brightness: 0.21 },
		animations: { retained: true },
	};
	const original: {
		source: typeof source;
		elements: [EffectElement, typeof neighbor];
	} = { source, elements: [element, neighbor] };
	let committed = structuredClone(original);
	let displayed = committed.elements[0].params;
	let draft = committed;
	const history = [structuredClone(committed)];
	const attempts: (typeof original)[] = [];
	let cursor = 0;
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	const render = () =>
		root.render(
			<EffectFields
				effect={{
					id: element.id,
					type: "bubble",
					enabled: true,
					params: displayed,
				}}
				element={committed.elements[0]}
				trackId="track"
				params={displayed}
				previewParams={({ params, animations }) => {
					draft = structuredClone(committed);
					draft.elements[0] = {
						...draft.elements[0],
						params,
						animations: animations ?? draft.elements[0].animations,
					};
					previewTracks = [{ elements: draft.elements }];
					displayed = params;
					render();
				}}
				commit={async () => {
					attempts.push(structuredClone(draft));
					const params = draft.elements[0].params;
					// Transport admission double, not a replacement for Rust validation.
					const count = Number(params.pointCount);
					const valid = Array.from(
						{ length: count - 1 },
						(_, index) =>
							Number(params[`point${index + 1}Time`]) >
							Number(params[`point${index}Time`]),
					).every(Boolean);
					if (valid) {
						committed = structuredClone(draft);
						history.splice(cursor + 1);
						history.push(structuredClone(committed));
						cursor++;
					}
					displayed = committed.elements[0].params;
					render();
					return valid;
				}}
			/>,
		);
	const input = (key: string) => {
		const node = container.querySelector<HTMLInputElement>(
			`input[aria-label="${key}"]`,
		);
		if (!node) throw new Error(`Missing Bubble input ${key}`);
		return node;
	};
	const click = async ({
		label,
		index = 0,
	}: {
		label: string;
		index?: number;
	}) => {
		const node = Array.from(container.querySelectorAll("button")).filter(
			(button) => button.textContent === label,
		)[index];
		if (!node) throw new Error(`Missing Bubble button ${label}/${index}`);
		await act(async () => {
			node.click();
		});
	};
	const edit = async ({ key, value }: { key: string; value: string }) => {
		const node = input(key);
		await act(async () => {
			node.focus();
		});
		await act(async () => {
			Object.getOwnPropertyDescriptor(
				dom.window.HTMLInputElement.prototype,
				"value",
			)?.set?.call(node, value);
			node.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
		});
		await act(async () => {
			node.blur();
		});
	};
	const expectUntouched = () => {
		expect(committed.source).toEqual(source);
		expect(committed.elements[1]).toEqual(neighbor);
		expect({ ...committed.elements[0], params: initial }).toEqual(element);
		expect(committed.elements[0].params).toMatchObject({
			amount: 0.73,
			refraction: -0.04,
			follow: 0.5,
		});
	};
	try {
		await act(async () => {
			render();
		});
		expect(container.querySelectorAll("input")).toHaveLength(3);
		await click({ label: "Remove point" });
		expect(attempts).toHaveLength(0);
		expect(input("point0Time").value).toBe("0");
		await click({ label: "Add point" });
		expect(attempts).toHaveLength(1);
		expect(committed.elements[0].params).toMatchObject({
			pointCount: 2,
			point1Time: 1,
			point1X: 0.25,
			point1Y: 0.45,
		});
		await edit({ key: "point1Time", value: "120000" });
		expect(attempts).toHaveLength(2);
		await edit({ key: "point1X", value: "0.777" });
		expect(attempts).toHaveLength(3);
		await click({ label: "Add point" });
		expect(attempts).toHaveLength(4);
		expect(committed.elements[0].params).toMatchObject({
			pointCount: 3,
			point2Time: 120001,
			point2X: 0.777,
			point2Y: 0.45,
		});
		await click({ label: "Remove point", index: 1 });
		expect(attempts).toHaveLength(5);
		expect(committed.elements[0].params).toMatchObject({
			pointCount: 2,
			point1Time: 120001,
			point1X: 0.777,
		});
		for (const axis of ["Time", "X", "Y"])
			expect(Object.hasOwn(committed.elements[0].params, `point2${axis}`)).toBe(
				false,
			);
		expectUntouched();
		// Full-source history is a transport double, not mounted ProjectStore evidence.
		const final = structuredClone(committed);
		for (cursor = history.length - 2; cursor >= 0; cursor--) {
			committed = structuredClone(history[cursor]);
			displayed = committed.elements[0].params;
			await act(async () => {
				render();
			});
			expect(input("point0X").value).toBe("0.25");
			expectUntouched();
		}
		expect(committed).toEqual(original);
		for (cursor = 1; cursor < history.length; cursor++) {
			committed = structuredClone(history[cursor]);
			displayed = committed.elements[0].params;
			await act(async () => {
				render();
			});
			expectUntouched();
		}
		cursor = history.length - 1;
		expect(committed).toEqual(final);
		await edit({ key: "point1Time", value: "0" });
		expect(attempts).toHaveLength(6);
		expect(discarded).toBe(1);
		expect(committed).toEqual(final);
		expect(input("point1Time").value).toBe("0");
		expect(input("point1X").value).toBe("0.777");
		expect(container.querySelector("[role=alert]")?.textContent).toContain(
			"Unsaved inputs are shown below",
		);
		await edit({ key: "point1Y", value: "0.321" });
		expect(attempts).toHaveLength(7);
		expect(discarded).toBe(2);
		expect(attempts[6].elements[0].params).toMatchObject({
			point1Time: 0,
			point1X: 0.777,
			point1Y: 0.321,
		});
		await edit({ key: "point1Time", value: "120002" });
		expect(attempts).toHaveLength(8);
		expect(committed.elements[0].params).toMatchObject({
			point1Time: 120002,
			point1X: 0.777,
			point1Y: 0.321,
		});
		expect(container.querySelector("[role=alert]")).toBeNull();
		expect(history).toHaveLength(7);
		expectUntouched();
	} finally {
		await act(async () => {
			root.unmount();
		});
		container.remove();
	}
});
