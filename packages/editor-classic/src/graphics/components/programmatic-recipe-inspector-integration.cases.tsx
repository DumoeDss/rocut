import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import type {
	MvPostAudio,
	ProgrammaticSource,
} from "@opencut/editor-contracts";
import { ProgrammaticRecipeDraft } from "./programmatic-recipe-draft";
import { recipeSource } from "./programmatic-recipe-fixture";

// Loaded only by the isolated .test.tsx child after a fresh runtime starts.
// Mounted React DOM, with a hand-authored catalog. This is not Rust/GPU/browser
// admission or durable command history; those belong to the native harness.
const require = createRequire(import.meta.url);
const dependencyRoot = process.env.RECIPE_UI_TEST_DEPENDENCIES;
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
const { act, useSyncExternalStore } = await import("react");
const { ProgrammaticRecipeFields } =
	await import("./programmatic-recipe-fields");

const number = (min: number, max: number, integer = false) => ({
	type: "number",
	min,
	max,
	integer,
});
const transitionParameters = {
	peel: {
		parameters: {
			direction: { type: "enum", options: ["left", "right", "up", "down"] },
			curl: number(0.05, 0.4),
			segments: number(8, 64, true),
			shading: number(0, 0.8),
			perspective: number(0, 0.8),
		},
	},
	bend: {
		parameters: {
			direction: { type: "enum", options: ["left", "right", "up", "down"] },
			hinge: number(0, 1),
			angle: number(Math.PI / 2, Math.PI),
			perspective: number(0, 0.8),
			shading: number(0, 1),
		},
	},
};
const finishing = {
	effects: {
		lightLeak: {
			parameters: {
				amount: { type: "number", min: 0, max: 1, required: true },
				alpha: { type: "enum", values: ["preserve", "expand"], required: true },
				seedOffset: {
					type: "integer",
					min: 0,
					max: 4294967295,
					required: false,
				},
			},
		},
	},
	automation: {
		version: 1,
		targetParameter: "amount",
		targetEffects: ["lightLeak"],
		maxCurves: 8,
		maxKeyframes: 256,
		easings: ["linear", "inOutSine"],
	},
};
function source() {
	const audio = {
		effect: 0,
		amount: 0.1,
		signal: {
			kind: "envelope",
			channel: "mix_rms",
			clock: "song",
			missing: "zero",
		},
		extra: "audio",
	} satisfies MvPostAudio & { extra: string };
	const fixture = {
		...recipeSource,
		extra: { provenance: "retained" },
		durationFrames: 24,
		recipe: {
			...recipeSource.recipe!,
			durationFrames: 999,
			extras: { retain: true },
			nodes: [
				...recipeSource.recipe!.nodes,
				{
					id: "peel",
					scene: {
						kind: "transition",
						from: "root",
						to: "root",
						span: { startFrame: 0, durationFrames: 12 },
						easing: "linear",
						style: {
							kind: "peel",
							direction: "left",
							curl: 0.2,
							segments: 16,
							shading: 0.2,
							perspective: 0.2,
							extra: "style",
						},
						extra: "scene",
					},
				},
				{
					id: "bend",
					scene: {
						kind: "transition",
						from: "root",
						to: "root",
						span: { startFrame: 0, durationFrames: 12 },
						easing: "linear",
						style: {
							kind: "bend",
							direction: "right",
							hinge: 0.5,
							angle: 2,
							perspective: 0.2,
							shading: 0.3,
						},
					},
				},
			],
			post: [
				{
					stage: "role",
					roles: ["graphics"],
					audio: [audio],
					effects: [
						{
							kind: "lightLeak",
							amount: 0.5,
							alpha: "preserve",
							seedOffset: 7,
							extra: "effect",
						},
					],
					extra: "post",
				},
			],
		},
	} as const;
	return fixture satisfies ProgrammaticSource;
}
async function mount(durationFrames = 24) {
	const original = { ...source(), durationFrames },
		draft = new ProgrammaticRecipeDraft(original),
		container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	let readOnly: string | null = null,
		conflict = false,
		commits = 0,
		release: (value: typeof recipeSource) => void = () => {};
	let submitted: typeof recipeSource | undefined;
	function Harness() {
		const state = useSyncExternalStore(draft.subscribe, draft.getSnapshot);
		return (
			<ProgrammaticRecipeFields
				id="integration"
				state={state}
				readOnly={readOnly}
				conflict={conflict}
				generators={{}}
				sceneParameters={{}}
				transitionParameters={transitionParameters}
				finishing={finishing}
				onEdit={(text) => draft.edit(text)}
				onDiscard={() => draft.discard()}
				onApply={() => {
					void draft.apply(async (snapshot) => {
						commits++;
						submitted = {
							...snapshot.baseline,
							recipe: JSON.parse(snapshot.text),
						};
						return new Promise((resolve) => {
							release = resolve;
						});
					});
				}}
			/>
		);
	}
	const render = async () => {
		await act(async () => root.render(<Harness />));
	};
	await render();
	return {
		draft,
		original,
		container,
		render,
		get commits() {
			return commits;
		},
		get submitted() {
			return submitted;
		},
		setMode: async (reason: string | null, changed: boolean) => {
			readOnly = reason;
			conflict = changed;
			await render();
		},
		finish: async () => {
			await act(async () => release(submitted!));
		},
		close: async () => {
			await act(async () => root.unmount());
			container.remove();
		},
	};
}
function control(container: HTMLElement, id: string) {
	const element = container.querySelector<HTMLInputElement | HTMLSelectElement>(
		`#${id}`,
	);
	if (!element) throw Error(`Missing mounted control ${id}`);
	return element;
}
async function change(
	element: HTMLInputElement | HTMLSelectElement,
	value: string,
) {
	await act(async () => {
		const prototype =
			element.tagName === "SELECT"
				? dom.window.HTMLSelectElement.prototype
				: dom.window.HTMLInputElement.prototype;
		Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
			element,
			value,
		);
		element.dispatchEvent(
			new dom.window.Event(element.tagName === "SELECT" ? "change" : "input", {
				bubbles: true,
			}),
		);
	});
}
async function click(container: HTMLElement, label: string) {
	const button = container.querySelector<HTMLButtonElement>(
		`button[aria-label="${label}"]`,
	);
	if (!button) throw Error(`Missing action ${label}`);
	await act(async () => button.click());
}

test("mounted transition and post controls share one retained draft and one Apply", async () => {
	const h = await mount();
	try {
		await change(control(h.container, "integration-transition-1-curl"), "0.3");
		await change(control(h.container, "integration-transition-2-hinge"), "0.7");
		await change(
			control(h.container, "integration-post-0-effect-0-amount"),
			"0.25",
		);
		const expected = JSON.parse(JSON.stringify(h.original.recipe));
		expected.nodes[1].scene.style.curl = 0.3;
		expected.nodes[2].scene.style.hinge = 0.7;
		expected.post[0].effects[0].amount = 0.25;
		expect(JSON.parse(h.draft.getSnapshot().text)).toEqual(expected);
		expect(h.draft.getSnapshot().baseline).toBe(h.original);
		expect(h.commits).toBe(0);
		expect(h.container.textContent).toContain(
			"outer source frames, including 24",
		);
		expect(h.container.textContent).not.toContain("including 999");
		const frame = h.container.querySelector<HTMLInputElement>(
			'[aria-label="New effect 0 lightLeak keyframe frame"]',
		)!;
		const value = h.container.querySelector<HTMLInputElement>(
			'[aria-label="New effect 0 lightLeak keyframe value"]',
		)!;
		const easing = h.container.querySelector<HTMLSelectElement>(
			'[aria-label="New effect 0 lightLeak keyframe easing"]',
		)!;
		expect(frame.max).toBe("24");
		await change(frame, "25");
		await change(value, "0.4");
		await change(easing, "linear");
		await click(h.container, "Add amount curve for effect 0 lightLeak");
		expect(JSON.parse(h.draft.getSnapshot().text)).toEqual(expected);
		await change(frame, "24");
		await click(h.container, "Add amount curve for effect 0 lightLeak");
		expected.post[0].automation = [
			{ effect: 0, keyframes: [{ frame: 24, value: 0.4, easing: "linear" }] },
		];
		expect(JSON.parse(h.draft.getSnapshot().text)).toEqual(expected);
		await click(h.container, "Apply recipe");
		await click(h.container, "Apply recipe");
		expect(h.commits).toBe(1);
		expect(h.draft.getSnapshot().pending).toBe(true);
		expect(h.submitted).toEqual({ ...h.original, recipe: expected });
		await h.finish();
		expect(h.draft.getSnapshot().dirty).toBe(false);
		expect(h.draft.getSnapshot().baseline.resources).toBe(h.original.resources);
	} finally {
		await h.close();
	}
});

test("mounted read-only, conflict and pending controls do not write; invalid JSON stays recoverable", async () => {
	const h = await mount();
	try {
		for (const [reason, conflict] of [
			["Compiled source", false],
			[null, true],
		] as const) {
			await h.setMode(reason, conflict);
			const text = h.draft.getSnapshot().text;
			const transition = control(h.container, "integration-transition-1-curl"),
				post = control(h.container, "integration-post-0-effect-0-amount");
			expect(transition.disabled).toBe(true);
			expect(post.disabled).toBe(true);
			await change(transition, "0.35");
			await change(post, "0.1");
			await click(h.container, "Apply recipe");
			expect(h.draft.getSnapshot().text).toBe(text);
			expect(h.commits).toBe(0);
		}
		await h.setMode(null, false);
		await change(control(h.container, "integration-transition-1-curl"), "0.3");
		await click(h.container, "Apply recipe");
		const pending = h.draft.getSnapshot().text;
		await change(
			control(h.container, "integration-post-0-effect-0-amount"),
			"0.1",
		);
		expect(h.draft.getSnapshot().text).toBe(pending);
		await h.finish();
		await act(async () => h.draft.edit("{invalid"));
		expect(
			h.container.querySelector("#integration-transition-1-curl"),
		).toBeNull();
		expect(
			h.container.querySelector("#integration-post-0-effect-0-amount"),
		).toBeNull();
		await click(h.container, "Apply recipe");
		expect(h.commits).toBe(1);
		expect(h.draft.getSnapshot().text).toBe("{invalid");
		expect(h.container.textContent).toContain("Recipe JSON is invalid");
		await click(h.container, "Discard recipe draft");
		expect(h.draft.getSnapshot().dirty).toBe(false);
	} finally {
		await h.close();
	}
});

test("invalid outer duration never enables mounted post curves despite recipe duration", async () => {
	for (const duration of [0, -1, 1.5, NaN]) {
		const h = await mount(duration);
		try {
			expect(
				h.container.querySelector(
					'[aria-label="New effect 0 lightLeak keyframe frame"]',
				),
			).toBeNull();
			expect(
				h.container.querySelector(
					'[aria-label="Add amount curve for effect 0 lightLeak"]',
				),
			).toBeNull();
			const before = h.draft.getSnapshot().text;
			expect(h.draft.getSnapshot().text).toBe(before);
			expect(h.commits).toBe(0);
			expect(
				control(h.container, "integration-transition-1-curl").disabled,
			).toBe(false);
		} finally {
			await h.close();
		}
	}
});

test("new keyframe visible entries survive an unrelated effect draft rerender", async () => {
	const h = await mount();
	try {
		const entry = <T extends HTMLInputElement | HTMLSelectElement>(
			label: string,
		) => {
			const field = h.container.querySelector<T>(`[aria-label="${label}"]`);
			if (!field) throw Error(`Missing mounted entry ${label}`);
			return field;
		};
		await change(
			entry<HTMLInputElement>("New effect 0 lightLeak keyframe frame"),
			"12",
		);
		await change(
			entry<HTMLInputElement>("New effect 0 lightLeak keyframe value"),
			"0.4",
		);
		await change(
			entry<HTMLSelectElement>("New effect 0 lightLeak keyframe easing"),
			"linear",
		);
		await change(
			control(h.container, "integration-post-0-effect-0-amount"),
			"0.3",
		);
		expect(
			entry<HTMLInputElement>("New effect 0 lightLeak keyframe frame").value,
		).toBe("12");
		expect(
			entry<HTMLInputElement>("New effect 0 lightLeak keyframe value").value,
		).toBe("0.4");
		expect(
			entry<HTMLSelectElement>("New effect 0 lightLeak keyframe easing").value,
		).toBe("linear");
		await click(h.container, "Add amount curve for effect 0 lightLeak");
		const recipe = JSON.parse(h.draft.getSnapshot().text);
		expect(recipe.post[0].automation).toEqual([
			{ effect: 0, keyframes: [{ frame: 12, value: 0.4, easing: "linear" }] },
		]);
		expect(recipe.post[0].effects[0].amount).toBe(0.3);
		expect(h.commits).toBe(0);
	} finally {
		await h.close();
	}
});
