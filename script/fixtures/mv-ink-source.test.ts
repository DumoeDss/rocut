import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { inkCharacterPixels } from "./mv-ink-assets";
import { inkCases } from "./mv-ink-cases";
import {
	INK_REFERENCE_FILES,
	type InkImage,
	type InkReference,
} from "./mv-ink-contract";
import { validateInkIdentities } from "./mv-ink-oracle-realm";
import { loadInkReference } from "./mv-ink-reference";
import { inkSample, validateInkContext } from "./mv-ink-source";

test("Ink matrix retains full growth, absolute clock offsets, boundaries and exact reverse repeats", () => {
	const cases = inkCases();
	expect(new Set(cases.map((item) => item.label)).size).toBe(12);
	for (const item of cases) {
		validateInkContext({ frame: item.frame, song: item.song });
		for (const index of item.indices)
			validateInkContext({
				frame: inkSample({ frame: item.frame, index }),
				song: item.song,
			});
		expect(item.indices).toContain(359);
		expect(item.indices.filter((index) => index === 180).length).toBe(2);
		expect(inkSample({ frame: item.frame, index: 5 }).time).toBe(
			item.frame.shotStart + 1 / 12,
		);
	}
	const offset = cases.find((item) => item.label === "off-grid-shot-start")!;
	expect(inkSample({ frame: offset.frame, index: 1 }).time).toBe(
		4.0375 + 1 / 60,
	);
	for (const seed of [0, 7])
		expect(cases.some((item) => item.frame.args.seed === seed)).toBe(true);
	for (const index of [-1, 360, 1.5, NaN])
		expect(() => inkSample({ frame: cases[0]!.frame, index })).toThrow();
});
test("Ink author context rejects undeclared resources and malformed clocks, without normalizing zero seed", () => {
	const { frame, song } = inkCases()[0]!;
	for (const args of [
		{ char: "" },
		{ char: "ink-character", seed: -1 },
		{ char: "ink-character", h: 0 },
		{ char: "ink-character", x: Infinity },
	])
		expect(() =>
			validateInkContext({ frame: { ...frame, args }, song }),
		).toThrow();
	for (const beats of [[], [1, 1], [1, 0], [NaN]])
		expect(() =>
			validateInkContext({ frame, song: { ...song, beats } }),
		).toThrow();
	expect(() =>
		validateInkContext({ frame: { ...frame, time: 10 }, song }),
	).toThrow();
	const zero = { ...frame, args: { char: "ink-character", seed: 0 } };
	validateInkContext({ frame: zero, song });
	expect(inkSample({ frame: zero, index: 5 }).args.seed).toBe(0);
});
test("Synthetic assets have changed content, actual dimensions and partial coverage independent of scene math", () => {
	const base = inkCharacterPixels(),
		changed = inkCharacterPixels({ changedBody: true });
	expect(base.width).toBe(480);
	expect(base.height).toBe(960);
	expect(changed.data).not.toEqual(base.data);
	const dimension = inkCharacterPixels({ width: 720, height: 1200 });
	expect(dimension.data.byteLength).toBe(720 * 1200 * 4);
	expect(
		base.data.some((value, index) => index % 4 === 3 && value === 128),
	).toBe(true);
	expect(base.data.some((value, index) => index % 4 === 3 && value === 0)).toBe(
		true,
	);
	expect(() => inkCharacterPixels({ width: 0 })).toThrow();
});
test("Oracle identity boundary rejects changed bytes, duplicate resources and reordered complete originals", async () => {
	const scripts = INK_REFERENCE_FILES.map((id) => ({
		id,
		code: `// ${id}`,
		sha256: createHash("sha256").update(`// ${id}`).digest("hex"),
	}));
	const reference: InkReference = { version: 1, scripts };
	const body = new Uint8Array([1, 2, 3]).buffer;
	const image: InkImage = {
		id: "ink-character",
		mimeType: "image/png",
		body,
		width: 480,
		height: 960,
		byteLength: 3,
		sha256: createHash("sha256").update(new Uint8Array(body)).digest("hex"),
	};
	await validateInkIdentities({ reference, images: [image] });
	await expect(
		validateInkIdentities({ reference, images: [image, image] }),
	).rejects.toThrow();
	await expect(
		validateInkIdentities({
			reference,
			images: [{ ...image, body: new Uint8Array([3, 2, 1]).buffer }],
		}),
	).rejects.toThrow();
	await expect(
		validateInkIdentities({
			reference: { ...reference, scripts: [...scripts].reverse() },
			images: [image],
		}),
	).rejects.toThrow();
	await expect(
		validateInkIdentities({
			reference: {
				...reference,
				scripts: scripts.map((script) => ({
					...script,
					code: script.code + " ",
				})),
			},
			images: [image],
		}),
	).rejects.toThrow();
	await expect(
		loadInkReference({ root: "relative-reference" }),
	).rejects.toThrow();
});
const referenceRoot = process.env.ROCUT_INK_REFERENCE_ROOT;
test.skipIf(!referenceRoot)(
	"Loader returns byte-identical whole originals including makeClock and all dark scenes",
	async () => {
		if (!referenceRoot) throw Error("Explicit reference root missing");
		const reference = await loadInkReference({ root: referenceRoot });
		for (const script of reference.scripts) {
			const bytes = await readFile(
				join(
					referenceRoot,
					"skills/vocaloid-style-mv/template/engine",
					script.id,
				),
			);
			expect(script.code).toBe(
				new TextDecoder("utf-8", { fatal: true }).decode(bytes),
			);
			expect(script.sha256).toBe(
				createHash("sha256").update(bytes).digest("hex"),
			);
		}
		expect(reference.scripts[0]!.code).toContain("Z.makeClock =");
		expect(reference.scripts[3]!.code).toContain("inkNet(a.seed || 7)");
	},
);
