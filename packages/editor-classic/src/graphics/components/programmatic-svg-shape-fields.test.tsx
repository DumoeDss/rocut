import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { BuildDraftSnapshot } from "./programmatic-build-draft";
import { ProgrammaticSvgShapeFields } from "./programmatic-svg-shape-fields";
import {
	changeSvgShapeText,
	editSvgShapeDraft,
	svgShapeTexts,
	svgShapeVisible,
} from "./programmatic-svg-shape-data";
const sha = "e".repeat(64);
const input = (id: string) => ({
	id,
	kind: "source" as const,
	mimeType: "application/octet-stream",
	byteLength: 12,
	sha256: sha,
	attachmentKey: `programmatic-source-sha256-${sha}`,
});
const resource = (
	id: string,
	kind: "model" | "document",
	mimeType: string,
) => ({
	...input(id),
	kind,
	mimeType,
	attachmentKey: `programmatic-sha256-${sha}`,
});
const authorProps = {
	assetKind: "svg",
	modelId: "logo.svg",
	shape: {
		modeling: { kind: "extrude", depth: 2, futureModeling: "keep" },
		curveSegments: 8,
		futureShape: ["keep"],
	},
	unknown: { keep: true },
	motion: { timeTicks: 17 },
};
function state(
	props: Record<string, unknown> = authorProps,
): BuildDraftSnapshot {
	return {
		baseline: {
			version: 1,
			runtime: "html-document",
			code: "",
			documentId: "compiled.html",
			resources: [
				resource("logo.svg", "model", "image/svg+xml"),
				resource("compiled.html", "document", "text/html"),
			],
			build: {
				engine: "three",
				entryFile: "model-feature-scene.ts",
				inputs: [input("model-feature-scene.ts")],
				inputProps: props,
			},
		} as unknown as BuildDraftSnapshot["baseline"],
		inputProps: JSON.stringify(props),
		selectedId: "model-feature-scene.ts",
		entryFile: "model-feature-scene.ts",
		fileIds: [],
		files: {},
		dirty: false,
		conflict: false,
		phase: null,
		error: null,
	};
}
const markup = (s = state(), canCompile = true) =>
	renderToStaticMarkup(
		<ProgrammaticSvgShapeFields
			id="svg"
			state={s}
			canCompile={canCompile}
			onEdit={() => {
				throw Error("render edited");
			}}
		/>,
	);
test("complete SVG archive renders only real loader controls, explicit units and no bevel invention", () => {
	const s = state(),
		html = markup(s);
	expect(svgShapeVisible(s)).toBe(true);
	expect(html).toContain("SVG modeling");
	expect(html).toContain("SVG depth (viewBox units)");
	expect(html).toContain("Curve segments (1–32)");
	expect(html).toContain("Bevel is unsupported");
	expect(html).not.toContain("bevelEnabled");
	expect(html).not.toContain("Recompile and apply</button>");
	expect(html).not.toContain('disabled=""');
	const text = svgShapeTexts(s)!;
	expect(text.depth).toBe("2");
	expect(html).not.toContain("Segment budget");
	expect(html).not.toContain("Vertex budget");
});
test("edits preserve all unknown data and absent optional fields without generating defaults", () => {
	const s = state(),
		result = changeSvgShapeText({
			state: s,
			canCompile: true,
			texts: svgShapeTexts(s)!,
			key: "depth",
			next: "3.25",
		});
	expect(result?.error).toBeUndefined();
	const props = JSON.parse(result!.inputProps!);
	expect(props.shape.modeling).toEqual({
		...authorProps.shape.modeling,
		depth: 3.25,
	});
	expect(props.shape.futureShape).toEqual(["keep"]);
	expect(props.unknown).toEqual(authorProps.unknown);
	expect(props.motion).toEqual(authorProps.motion);
	expect(Object.hasOwn(props.shape, "maxSegments")).toBe(false);
	expect(Object.hasOwn(props.shape, "maxVertices")).toBe(false);
	expect(s.inputProps).toBe(JSON.stringify(authorProps));
	const explicit = changeSvgShapeText({
		state: s,
		canCompile: true,
		texts: result!.texts,
		key: "curveSegments",
		next: "16",
	});
	expect(JSON.parse(explicit!.inputProps!).shape.curveSegments).toBe(16);
});
test("flat/extrude switch never guesses depth, removes only extrusion depth on explicit flat choice", () => {
	const flat = state({
			...authorProps,
			shape: { modeling: { kind: "flat", future: true }, curveSegments: 4 },
		}),
		initial = svgShapeTexts(flat)!;
	expect(markup(flat)).not.toContain("SVG depth (viewBox units)");
	const extrude = changeSvgShapeText({
		state: flat,
		canCompile: true,
		texts: initial,
		key: "kind",
		next: "extrude",
	});
	expect(extrude?.inputProps).toBeUndefined();
	expect(extrude?.error).toContain("no depth is generated");
	expect(extrude?.texts.depth).toBe("");
	const depth = changeSvgShapeText({
		state: flat,
		canCompile: true,
		texts: extrude!.texts,
		key: "depth",
		next: "0.75",
	});
	expect(JSON.parse(depth!.inputProps!).shape.modeling).toEqual({
		kind: "extrude",
		future: true,
		depth: 0.75,
	});
	const s = state(),
		switched = changeSvgShapeText({
			state: s,
			canCompile: true,
			texts: svgShapeTexts(s)!,
			key: "kind",
			next: "flat",
		});
	expect(JSON.parse(switched!.inputProps!).shape.modeling).toEqual({
		kind: "flat",
		futureModeling: "keep",
	});
	expect(JSON.parse(switched!.inputProps!).shape.curveSegments).toBe(8);
});
test("invalid local numbers remain visible and never produce an author edit", () => {
	const s = state();
	for (const [key, values] of [
		["depth", ["", "0", "-1", "1e999", '"2"', "bad"]],
		["curveSegments", ["", "0", "33", "1.5", "null", "true"]],
	] as const)
		for (const next of values) {
			const result = changeSvgShapeText({
				state: s,
				canCompile: true,
				texts: svgShapeTexts(s)!,
				key,
				next,
			});
			expect(result?.texts[key]).toBe(next);
			expect(result?.inputProps).toBeUndefined();
			expect(result?.error).toBeDefined();
		}
	for (const [key, next] of [["curveSegments", "32"]] as const)
		expect(
			changeSvgShapeText({
				state: s,
				canCompile: true,
				texts: svgShapeTexts(s)!,
				key,
				next,
			})?.inputProps,
		).toBeDefined();
});
test("busy/conflict/unconfigured block change while retaining draft; malformed complete JSON asks correction", () => {
	const s = state();
	for (const blocked of [
		{ ...s, phase: "compile" },
		{ ...s, conflict: true },
	]) {
		expect(markup(blocked as BuildDraftSnapshot)).toContain('disabled=""');
		expect(
			changeSvgShapeText({
				state: blocked as BuildDraftSnapshot,
				canCompile: true,
				texts: svgShapeTexts(s)!,
				key: "depth",
				next: "3",
			}),
		).toBeUndefined();
	}
	expect(markup(s, false)).toContain('disabled=""');
	expect(
		changeSvgShapeText({
			state: s,
			canCompile: false,
			texts: svgShapeTexts(s)!,
			key: "depth",
			next: "3",
		}),
	).toBeUndefined();
	const invalid = { ...s, inputProps: "{bad" };
	expect(markup(invalid)).toContain("Fix complete Input props JSON");
	expect(
		editSvgShapeDraft({ state: invalid, texts: svgShapeTexts(s)! }).inputProps,
	).toBeUndefined();
});
test("only static SVG closures with unique valid source and SVG/document descriptors enter", () => {
	const s = state();
	for (const props of [
		{ ...authorProps, assetKind: "model" },
		{ ...authorProps, animation: { clip: 0 } },
		{ ...authorProps, shape: { modeling: { kind: "flat", depth: 2 } } },
		{ ...authorProps, shape: { modeling: { kind: "extrude", depth: 0 } } },
	])
		expect(svgShapeVisible(state(props))).toBe(false);
	for (const patch of [
		{ entryFile: "arbitrary.ts" },
		{ engine: "remotion" },
		{ inputs: [] },
		{
			inputs: [
				input("model-feature-scene.ts"),
				input("model-feature-scene.ts"),
			],
		},
		{ inputs: [{ ...input("model-feature-scene.ts"), kind: "model" }] },
		{
			inputs: [{ ...input("model-feature-scene.ts"), mimeType: "text/plain" }],
		},
		{
			inputs: [
				{
					...input("model-feature-scene.ts"),
					attachmentKey: `programmatic-sha256-${sha}`,
				},
			],
		},
		{ inputs: [{ ...input("model-feature-scene.ts"), byteLength: 0 }] },
	])
		expect(
			svgShapeVisible({
				...s,
				baseline: { ...s.baseline, build: { ...s.baseline.build!, ...patch } },
			} as BuildDraftSnapshot),
		).toBe(false);
	for (const resources of [
		[],
		[
			resource("logo.svg", "model", "model/gltf-binary"),
			resource("compiled.html", "document", "text/html"),
		],
		[resource("logo.svg", "model", "image/svg+xml")],
		[...s.baseline.resources!, resource("logo.svg", "model", "image/svg+xml")],
	])
		expect(
			svgShapeVisible({ ...s, baseline: { ...s.baseline, resources } }),
		).toBe(false);
});
test("ordinary, Glass, Ink, Particle and Liquid static SVG closure variants are exact and capabilities remain required", () => {
	for (const [entry, ids, capability] of [
		["glass-object-scene.ts", ["glass-object-scene.ts"], undefined],
		[
			"ink-object-scene.ts",
			[
				"ink-object-scene.ts",
				"object-animation.mjs",
				"object-animation-clip-selection.mjs",
			],
			undefined,
		],
		["particle-scene.ts", ["particle-scene.ts"], "particle-surface-v1"],
		[
			"liquid-object-scene.ts",
			["liquid-object-scene.ts", "liquid-object-geometry.mjs"],
			"liquid-object-v1",
		],
	] as const) {
		const s = state(),
			testState = {
				...s,
				baseline: {
					...s.baseline,
					build: {
						...s.baseline.build!,
						entryFile: entry,
						inputs: ids.map(input),
						capabilities: capability ? [capability] : undefined,
					},
				},
			};
		expect(svgShapeVisible(testState)).toBe(true);
		if (capability)
			expect(
				svgShapeVisible({
					...testState,
					baseline: {
						...testState.baseline,
						build: { ...testState.baseline.build, capabilities: [] },
					},
				}),
			).toBe(false);
	}
	const s = state();
	expect(
		svgShapeVisible({
			...s,
			baseline: {
				...s.baseline,
				build: {
					...s.baseline.build!,
					entryFile: "glass-object-scene.ts",
					inputs: [
						input("glass-object-scene.ts"),
						input("object-animation.mjs"),
					],
				},
			},
		}),
	).toBe(false);
});

test("draft resource or animation changes cannot bypass the SVG-only author boundary", () => {
	const s = state();
	for (const patch of [
		{ modelId: "undeclared.svg" },
		{ assetKind: "model" },
		{ animation: { clip: 0, mode: "clamp" } },
	]) {
		const draft = {
			...s,
			inputProps: JSON.stringify({ ...authorProps, ...patch }),
		};
		const result = changeSvgShapeText({
			state: draft,
			canCompile: true,
			texts: svgShapeTexts(draft)!,
			key: "depth",
			next: "3",
		});
		expect(result?.inputProps).toBeUndefined();
		expect(result?.error).toBeDefined();
	}
	for (const patch of [
		{ byteLength: 0 },
		{ byteLength: 1.5 },
		{ sha256: "E".repeat(64) },
		{ attachmentKey: `programmatic-source-sha256-${sha}` },
	]) {
		const resources = [
			{ ...resource("logo.svg", "model", "image/svg+xml"), ...patch },
			resource("compiled.html", "document", "text/html"),
		];
		expect(
			svgShapeVisible({ ...s, baseline: { ...s.baseline, resources } }),
		).toBe(false);
	}
});
