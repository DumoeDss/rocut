import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createContext, Script } from "node:vm";
import { loadConvergeReference } from "./mv-converge-reference";
import {
	CONVERGE_REFERENCE_FILES,
	type ConvergeOriginalEngine,
} from "./mv-converge-reference-contract";
import { snapshotConvergeFrame } from "./mv-converge-reference-browser";

const root = process.env.ROCUT_CONVERGE_REFERENCE_ROOT;
test("converge oracle requires explicit absolute original checkout", async () => {
	await expect(loadConvergeReference("relative-reference")).rejects.toThrow(
		"absolute converge reference",
	);
});
// Registration-only smoke proof: never claimed as native Canvas pixel evidence.
test.skipIf(!root)(
	"converge executes full original helper files and actual upstream makeClock",
	async () => {
		const reference = await loadConvergeReference(root!);
		expect(reference.scripts.map((script) => script.id)).toEqual([
			...CONVERGE_REFERENCE_FILES,
		]);
		const allocated: { width: number; height: number }[] = [],
			fontRequests: string[] = [];
		const window: { Z?: ConvergeOriginalEngine } = {};
		const context = createContext({
			window,
			URL,
			fetch() {
				throw Error("Oracle registration must not fetch media");
			},
			document: {
				baseURI: "https://rocut-oracle.invalid/engine/index.html",
				createElement(tag: string) {
					expect(tag).toBe("canvas");
					const c = {
						width: 0,
						height: 0,
						getContext() {
							return {};
						},
					};
					allocated.push(c);
					return c;
				},
				fonts: {
					async load(spec: string) {
						fontRequests.push(spec);
						return [];
					},
				},
			},
		});
		for (const source of reference.scripts) {
			const bytes = await readFile(
				join(root!, "skills/vocaloid-style-mv/template/engine", source.id),
			);
			expect(new TextEncoder().encode(source.code)).toEqual(
				new Uint8Array(bytes),
			);
			expect(source.sha256).toBe(
				createHash("sha256").update(bytes).digest("hex"),
			);
			new Script(source.code, { filename: source.id }).runInContext(context, {
				timeout: 1000,
			});
		}
		expect(allocated.map((c) => [c.width, c.height])).toEqual([[1600, 900]]);
		const original = reference.scripts[3]!.code,
			begin = original.indexOf("function convergeDraw("),
			end = original.indexOf("\n  Z.scene('converge',", begin);
		expect(begin).toBeGreaterThan(0);
		expect(end).toBeGreaterThan(begin);
		expect(window.Z!.SCENES.converge!.draw.toString()).toBe(
			original.slice(begin, end).trim(),
		);
		await window.Z!.SCENES.converge!.init();
		await window.Z!.SCENES.converge!.init();
		expect(fontRequests).toHaveLength(10);
		const clock = window.Z!.makeClock([1, 1.7, 2.6], 120);
		expect(clock.pulse(0, 8)).toBe(0);
		expect(clock.pulse(1.7, 8)).toBe(1);
		expect(clock.idx(1.699)).toBe(0);
		expect(clock.since(2.8)).toBeCloseTo(0.2, 12);
		for (const mechanism of [
			"inwardStreaks(ctx",
			"const spiral =",
			"const kin =",
			"for (let i = 0; i < 34",
			"for (let i = 0; i < 140",
			"grain(ctx, t, a.grain ?? 0.07)",
			"const wk = E.inExpo",
			"if (t >= whiteAt)",
			"S.clock.pulse(t, 8)",
		])
			expect(window.Z!.SCENES.converge!.draw.toString()).toContain(mechanism);
	},
);
test("converge frame snapshot refuses nonfinite/out-of-shot authored times", () => {
	const input = {
		time: 12.25,
		shotStart: 12.25,
		duration: 4,
		args: { seed: 7, whiteAt: 15.75, grain: 0.07 },
	};
	const snap = snapshotConvergeFrame(input);
	input.args.seed = 19;
	expect(snap.args.seed).toBe(7);
	for (const change of [
		{ time: NaN },
		{ time: 12 },
		{ time: 17 },
		{ shotStart: -1 },
		{ duration: 0 },
	])
		expect(() => snapshotConvergeFrame({ ...input, ...change })).toThrow();
	for (const change of [
		{ seed: -1 },
		{ seed: 0 },
		{ seed: 1.2 },
		{ grain: 2 },
		{ grain: NaN },
		{ whiteAt: 12.25 },
		{ whiteAt: Infinity },
		{ unknown: true },
	])
		expect(() =>
			snapshotConvergeFrame({ ...input, args: { ...input.args, ...change } }),
		).toThrow();
	expect(
		snapshotConvergeFrame({ ...input, args: { ...input.args, whiteAt: 17 } })
			.args.whiteAt,
	).toBe(17);
});
