import { expect, test } from "bun:test";
import type {
	MvRecipePlan,
	ProgrammaticSource,
} from "@opencut/editor-contracts";
import {
	resolveProgrammaticFrame,
	type ProgrammaticFrame,
} from "../../packages/editor-classic/src/services/renderer/programmatic/frame";
import {
	consumeMvNativeRasterTicket,
	prepareMvNativeRasterTicket,
} from "../../packages/editor-classic/src/services/renderer/programmatic/mv-native-admission";

function fixture(): {
	source: ProgrammaticSource;
	frame: ProgrammaticFrame & { recipePlan: MvRecipePlan };
} {
	const source: ProgrammaticSource = {
		version: 1,
		runtime: "canvas-worker",
		code: "",
		width: 64,
		height: 64,
		frameRate: { numerator: 30, denominator: 1 },
		durationFrames: 30,
		seed: 17,
		recipe: {
			version: 1,
			songStartSeconds: 1.5,
			outputRoles: ["background"],
			root: "fill",
			post: [],
			nodes: [
				{
					id: "fill",
					scene: { kind: "solid", role: "background", color: [1, 0, 0, 0.5] },
				},
			],
		},
	};
	const frame = resolveProgrammaticFrame({
		source,
		clipStart: 0,
		clipDuration: 120000,
		trimStart: 0,
		timelineTime: 8000,
	});
	if (!frame?.recipePlan) throw Error("Missing independent Rust solid plan");
	return { source, frame: { ...frame, recipePlan: frame.recipePlan } };
}

test("only fresh native admission mints a single-use, non-cloneable ticket", async () => {
	const { source, frame } = fixture();
	const ticket = await prepareMvNativeRasterTicket({ source, frame });
	for (const invalid of [
		undefined,
		null,
		{},
		structuredClone(ticket),
		frame,
		source,
	])
		expect(() => consumeMvNativeRasterTicket(invalid)).toThrow(
			"Invalid or consumed",
		);
	expect(Object.isFrozen(ticket)).toBe(true);
	const input = consumeMvNativeRasterTicket(ticket);
	expect(input.frame.recipePlan).toEqual(frame.recipePlan);
	expect(input.width).toBe(64);
	expect(input.height).toBe(64);
	expect(input.resources).toEqual([]);
	expect(input.sequenceImages).toEqual([]);
	expect(Object.keys(input).sort()).toEqual([
		"frame",
		"height",
		"imageAdmissions",
		"resources",
		"sequenceImages",
		"width",
	]);
	expect(() => consumeMvNativeRasterTicket(ticket)).toThrow(
		"Invalid or consumed",
	);
});

test("an attacker-provided drawing plan, limits and facts cannot be promoted to DOM input", async () => {
	const { source, frame } = fixture();
	const forged: ProgrammaticFrame = {
		...frame,
		recipePlan: {
			...frame.recipePlan!,
			root: { kind: "solid", role: "background", color: [0, 1, 0, 1] },
		},
		imageDecodeLimits: {
			maxDecodedBytes: Number.MAX_SAFE_INTEGER,
			maxDimension: Number.MAX_SAFE_INTEGER,
		},
		fontMetrics: [],
		imageDimensions: [],
	};
	const input = consumeMvNativeRasterTicket(
		await prepareMvNativeRasterTicket({ source, frame: forged }),
	);
	expect(input.frame.recipePlan).toEqual(frame.recipePlan);
	expect(input.frame.imageDecodeLimits).toBeUndefined();
	expect("fontMetrics" in input.frame).toBe(false);
	expect("imageDimensions" in input.frame).toBe(false);
});

test("admission owns the source and plan across the first asynchronous boundary", async () => {
	const { source, frame } = fixture();
	const expected = structuredClone(frame.recipePlan);
	const pending = prepareMvNativeRasterTicket({ source, frame });
	// Readonly contracts are compile-time only; a JS caller can mutate them.
	Reflect.set(source, "width", 8192);
	Reflect.set(source, "code", "parent.postMessage('not allowed', '*')");
	Reflect.set(source.recipe!.nodes[0], "scene", {
		kind: "solid",
		role: "background",
		color: [0, 1, 0, 1],
	});
	expect(source.width).toBe(8192);
	const input = consumeMvNativeRasterTicket(await pending);
	expect(input.width).toBe(64);
	expect(input.frame.recipePlan).toEqual(expected);
});

test("authored JS, invalid native sources, extra resources and cancelled work cannot mint tickets", async () => {
	const { source, frame } = fixture();
	const { recipe: _recipe, ...plain } = source;
	for (const invalid of [
		{ ...plain, code: "throw Error('author')" },
		{ ...source, code: "throw Error('author')" },
		{ ...source, width: 8192 },
	])
		await expect(
			prepareMvNativeRasterTicket({ source: invalid, frame }),
		).rejects.toThrow();
	await expect(
		prepareMvNativeRasterTicket({
			source,
			frame,
			resources: [
				{
					resource: {
						id: "extra",
						kind: "analysis",
						attachmentKey: "extra",
						mimeType: "application/json",
						byteLength: 0,
						sha256: "0".repeat(64),
					},
					body: new ArrayBuffer(0),
				},
			],
		}),
	).rejects.toThrow("Missing programmatic resources");
	await expect(
		prepareMvNativeRasterTicket({
			source,
			frame,
			signal: AbortSignal.abort(Error("stop-native")),
		}),
	).rejects.toThrow("stop-native");
	const controller = new AbortController();
	const pending = prepareMvNativeRasterTicket({
		source,
		frame,
		signal: controller.signal,
	});
	controller.abort(Error("stop-during-admission"));
	await expect(pending).rejects.toThrow("stop-during-admission");
});
