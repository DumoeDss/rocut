import { expect, mock, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import type { ProgrammaticFrame } from "./frame";

// Routing doubles must never replace admission/raster code in another suite.
if (process.env.ROCUT_CANVAS_ROUTING_ISOLATED !== "1") {
	test("canvas routing uses an isolated process (not a pixel/admission test)", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			env: { ...process.env, ROCUT_CANVAS_ROUTING_ISOLATED: "1" },
			stdout: "pipe",
			stderr: "pipe",
		});
		if (result.exitCode !== 0)
			throw Error(result.stdout.toString() + result.stderr.toString());
	}, 15000);
} else {
	const calls: { method: string; input: unknown }[] = [];
	const ticket = Object.freeze({ native: true });
	const bitmap: ImageBitmap = Object.freeze({
		width: 64,
		height: 64,
		close() {},
	});
	const sequences: never[] = [];
	let admissionError: Error | undefined;
	const resolvedFrame: ProgrammaticFrame = {
		index: 7,
		time: 7 / 30,
		timelineTime: 28000,
		sourceTime: 28000,
		frameRate: { numerator: 30, denominator: 1 },
		durationFrames: 30,
		seed: 9,
	};
	for (const [module, method, result] of [
		["sandbox-runtime", "runProgrammaticSandbox", bitmap],
		["mv-resource-frame", "resolveMvResourceFrame", resolvedFrame],
		["image-sequence-resources", "resolveCanvasSequenceImages", sequences],
		["mv-native-runtime", "runMvNativeRaster", bitmap],
	] as const)
		mock.module(
			fileURLToPath(new URL(`./${module}.ts`, import.meta.url)),
			() => ({
				[method]: async (input: unknown) => {
					calls.push({ method, input });
					return result;
				},
			}),
		);
	mock.module("./mv-native-admission", () => ({
		prepareMvNativeRasterTicket: async (input: unknown) => {
			calls.push({ method: "prepareMvNativeRasterTicket", input });
			if (admissionError) throw admissionError;
			return ticket;
		},
	}));
	const { renderProgrammaticCanvas } = await import("./canvas-runtime");

	function source(kinds?: string[]): ProgrammaticSource {
		return {
			version: 1,
			runtime: "canvas-worker",
			code: kinds ? "" : "ctx.fillRect(0, 0, 1, 1)",
			width: 64,
			height: 64,
			frameRate: resolvedFrame.frameRate,
			durationFrames: 30,
			seed: 9,
			...(kinds
				? {
						recipe: {
							version: 1 as const,
							songStartSeconds: 0,
							root: "node0",
							outputRoles: ["background" as const],
							post: [],
							nodes: kinds.map((kind, index) => {
								const scene = {
									kind: "solid" as const,
									role: "background" as const,
									color: [0, 0, 0, 1] as const,
								};
								// Only discriminants are observed at this platform seam.
								// Real Rust source/resource validation is tested separately.
								Reflect.set(scene, "kind", kind);
								return { id: `node${index}`, scene };
							}),
						},
					}
				: {}),
		};
	}

	for (const kinds of [
		["ember"],
		["titleRiff"],
		["solid", "titleRiff"],
		["solid", "ember"],
		["kanjiSlam"],
		["solid", "kanjiSlam"],
		["solid", "titleRiff", "kanjiSlam"],
	])
		test(`native route remains stable for declared ${kinds.join("/")}`, async () => {
			calls.length = 0;
			const input = {
				source: source(kinds),
				frame: resolvedFrame,
				resources: [],
				signal: new AbortController().signal,
			};
			expect(await renderProgrammaticCanvas(input)).toBe(bitmap);
			expect(calls).toEqual([
				{
					method: "prepareMvNativeRasterTicket",
					input: { ...input, provider: undefined },
				},
				{
					method: "runMvNativeRaster",
					input: { ticket, signal: input.signal },
				},
			]);
		});

	for (const kinds of [undefined, ["solid"], ["typeCard"]])
		test(`authored JS/ordinary ${kinds?.join("/") ?? "JS"} stays on the Worker`, async () => {
			calls.length = 0;
			const input = {
				source: source(kinds),
				frame: { ...resolvedFrame, index: 1 },
				resources: [],
				signal: new AbortController().signal,
			};
			expect(await renderProgrammaticCanvas(input)).toBe(bitmap);
			expect(calls.map((call) => call.method)).toEqual([
				"resolveMvResourceFrame",
				"resolveCanvasSequenceImages",
				"runProgrammaticSandbox",
			]);
			expect(calls[1]?.input).toEqual({
				frame: resolvedFrame,
				provider: undefined,
				signal: input.signal,
			});
			expect(calls[2]?.input).toEqual({
				...input,
				frame: resolvedFrame,
				sequenceImages: sequences,
				operation: "render",
			});
		});

	for (const kind of ["titleRiff", "kanjiSlam"])
		test(`failed ${kind} admission never falls back to author code or another rasterizer`, async () => {
			calls.length = 0;
			admissionError = Error("invalid native resources");
			try {
				await expect(
					renderProgrammaticCanvas({
						source: source(["solid", kind]),
						frame: resolvedFrame,
					}),
				).rejects.toThrow("invalid native resources");
				expect(calls.map((call) => call.method)).toEqual([
					"prepareMvNativeRasterTicket",
				]);
			} finally {
				admissionError = undefined;
			}
		});
}
