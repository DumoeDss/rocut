import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createContext, Script } from "node:vm";
import { loadAfterimageReference } from "./mv-afterimage-reference";
import {
	AFTERIMAGE_FONT_FACES,
	AFTERIMAGE_REFERENCE_FILES,
	AFTERIMAGE_REFERENCE_TEXT,
} from "./mv-afterimage-reference-contract";

const root = process.env.ROCUT_AFTERIMAGE_REFERENCE_ROOT;

test("afterimage fixture rejects an implicit or relative reference checkout", async () => {
	await expect(loadAfterimageReference("relative-checkout")).rejects.toThrow(
		"absolute reference checkout",
	);
});

// Registration-only VM smoke check. Fake canvas contexts are NEVER pixel evidence;
// the browser harness later calls the actual captured draw with native Canvas2D.
test.skipIf(!root)(
	"complete original afterimage registers without media IO or drawing",
	async () => {
		const reference = await loadAfterimageReference(root!);
		expect(reference.scripts.map((script) => script.id)).toEqual([
			...AFTERIMAGE_REFERENCE_FILES,
		]);
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
		}
		const fontRequests: string[] = [];
		const allocated: { width: number; height: number }[] = [];
		const window = { Z: undefined as any };
		const context = createContext({
			window,
			URL,
			fetch() {
				throw Error("Registration must not fetch media");
			},
			document: {
				baseURI: "https://rocut-oracle.invalid/engine/index.html",
				createElement(tag: string) {
					expect(tag).toBe("canvas");
					const canvas = {
						width: 0,
						height: 0,
						getContext() {
							return {};
						},
					};
					allocated.push(canvas);
					return canvas;
				},
				fonts: {
					async load(spec: string) {
						fontRequests.push(spec);
						return [];
					},
				},
			},
		});
		for (const source of reference.scripts)
			new Script(source.code, { filename: source.id }).runInContext(context, {
				timeout: 1000,
			});
		expect(allocated.map(({ width, height }) => [width, height])).toEqual([
			[1600, 900],
		]);
		const scene = window.Z.SCENES.afterimage;
		expect(scene.preload(AFTERIMAGE_REFERENCE_TEXT)).toEqual([
			AFTERIMAGE_REFERENCE_TEXT.char,
		]);
		expect(window.Z.loaded.size).toBe(0);
		await scene.init();
		expect(fontRequests).toHaveLength(10);
		for (const definition of AFTERIMAGE_FONT_FACES)
			expect(
				fontRequests.some(
					(spec) =>
						spec.startsWith(`${definition.weight} `) &&
						spec.endsWith(`"${definition.family}"`),
				),
			).toBe(true);
		await scene.init();
		expect(fontRequests).toHaveLength(10);
		const original = reference.scripts[3]!.code;
		const begin = original.indexOf("function afterDraw("),
			end = original.indexOf("\n  Z.scene('afterimage',", begin);
		expect(begin).toBeGreaterThan(0);
		expect(end).toBeGreaterThan(begin);
		expect(scene.draw.toString()).toBe(original.slice(begin, end).trim());
		expect(scene.draw.toString()).toContain("grain(ctx, t, a.grain ?? 0.05)");
		for (const layer of ["fringe", "sharp", "mid", "soft", "halo"])
			expect(scene.draw.toString()).toContain(`ctx.drawImage(G.${layer},`);
		expect(original).toContain("function lockupMask(a)");
		expect(original).toContain("function glyph(ctx,");
	},
);
