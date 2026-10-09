import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createContext, Script } from "node:vm";
import { loadTypeCardReference } from "./mv-type-card-reference";
import { typeCardFontCoverage } from "./mv-type-card-reference-cmap";
import {
	TYPE_CARD_REFERENCE_FILES,
	type TypeCardOriginalEngine,
	type TypeCardOriginalWindow,
	type TypeCardReferenceArgs,
	type TypeCardReferenceFrame,
} from "./mv-type-card-reference-contract";
import {
	loadTypeCardFonts,
	snapshotTypeCardFonts,
} from "./mv-type-card-reference-fonts";
import { snapshotTypeCardFrame } from "./mv-type-card-reference-frame";

const root = process.env.ROCUT_TYPE_CARD_REFERENCE_ROOT;
const FONT_DIR = new URL(
	"../../apps/web/public/motion-text/fonts/",
	import.meta.url,
);
const fontBytes = async (file: string) =>
	Uint8Array.from(await readFile(new URL(file, FONT_DIR))).buffer;
const fixture = (): TypeCardReferenceFrame => ({
	args: { mode: "quiet", lines: ["AB"] },
	time: 1,
	shotStart: 0,
	duration: 4,
	beats: [0, 1, 2, 3],
});

test("typeCard loader refuses an implicit reference checkout", async () => {
	await expect(loadTypeCardReference("relative-checkout")).rejects.toThrow(
		"absolute typeCard reference checkout",
	);
});

// This VM only proves registration/source identity, never Canvas2D pixel parity.
test.skipIf(!root)(
	"complete original typeCard registers without media IO or eager drawing",
	async () => {
		const reference = await loadTypeCardReference(root!);
		expect(reference.scripts.map((script) => script.id)).toEqual([
			...TYPE_CARD_REFERENCE_FILES,
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
		const window: { Z?: TypeCardOriginalEngine } = {},
			fontRequests: string[] = [];
		const context = createContext({
			window,
			URL,
			fetch() {
				throw Error("Registration must not fetch media");
			},
			document: {
				baseURI: "https://rocut-oracle.invalid/engine/index.html",
				createElement() {
					throw Error("Registration must not allocate eager drawing surfaces");
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
		const scene = window.Z!.SCENES.typeCard!;
		expect(typeof scene.draw).toBe("function");
		expect(scene.draw.toString()).toBe(
			"draw(ctx, S) {\n      const a = cardCfg(S.args);\n      if (a.mode === 'flicker') drawFlicker(ctx, S, a); else drawQuiet(ctx, S, a);\n    }".replaceAll(
				"\n",
				reference.scripts[3]!.code.includes("\r\n") ? "\r\n" : "\n",
			),
		);
		await scene.init();
		await scene.init();
		expect(fontRequests).toHaveLength(10);
		for (const spec of [
			'500 100px "Shippori Mincho B1"',
			'400 100px "Dela Gothic One"',
			'400 100px "DotGothic16"',
		])
			expect(fontRequests).toContain(spec);
		const original = reference.scripts[3]!.code;
		for (const layer of [
			"function inkBox(",
			"function drawQuiet(",
			"function drawFlicker(",
			"function drawMorse(",
			"filmGrain(ctx, S.t, 0.035, 'screen')",
			"filmGrain(ctx, t, 0.05, 'screen')",
			"const tc = Z.scratch[1]",
			"const neg = Z.clamp((toWhite - 0.35) / 0.65)",
		])
			expect(original).toContain(layer);
	},
);

test("local Japanese and Latin glyph proof uses real supplied SFNT bytes", async () => {
	for (const [file, sample] of [
		["shippori-mincho-b1-extrabold.ttf", "ABafterglow\u591c\u3082\u5149"],
		["dela-gothic-one-regular.ttf", "HELP\u6551\u3063\u3066"],
		["dot-gothic-16-regular.ttf", "SOS"],
	] as const) {
		const cover = typeCardFontCoverage(await fontBytes(file)),
			glyphs = cover(sample);
		expect(glyphs.length).toBe(new Set([...sample]).size);
		expect(glyphs.every((entry) => entry.glyphId > 0)).toBe(true);
		expect(() => cover("\u{10ffff}")).toThrow("fallback refused");
		expect(() => cover("\ud800")).toThrow("non-scalar");
	}
	expect(() => typeCardFontCoverage(new ArrayBuffer(3))).toThrow("Truncated");
	expect(() => typeCardFontCoverage(new ArrayBuffer(12))).toThrow(
		"uncompressed SFNT",
	);
});

test("font snapshot is private, rejects duplicate aliases and never admits absent exact weights", async () => {
	const bytes = await fontBytes("shippori-mincho-b1-extrabold.ttf");
	const snapshots = snapshotTypeCardFonts([
		{ family: "Shippori Mincho B1", weight: 500, bytes },
	]);
	expect(snapshots[0]!.bytes).not.toBe(bytes);
	const saved = new Uint8Array(snapshots[0]!.bytes)[0];
	new Uint8Array(bytes)[0] = 255;
	expect(new Uint8Array(snapshots[0]!.bytes)[0]).toBe(saved);
	expect(() => snapshotTypeCardFonts([])).toThrow("explicit local");
	expect(() =>
		snapshotTypeCardFonts([{ ...snapshots[0]!, family: "bad, serif" }]),
	).toThrow("one explicit family");
	expect(() =>
		snapshotTypeCardFonts([
			snapshots[0]!,
			{ ...snapshots[0]!, family: "shippori mincho b1" },
		]),
	).toThrow("Duplicate");
	const faces = new Set<FontFace>();
	class FakeFace {
		status = "loaded";
		constructor(
			readonly family: string,
			_bytes: ArrayBuffer,
			readonly descriptors: { weight: string },
		) {}
		async load() {
			return this;
		}
	}
	const realm = {
		FontFace: FakeFace,
		document: {
			fonts: {
				add(face: FontFace) {
					faces.add(face);
				},
				has(face: FontFace) {
					return faces.has(face);
				},
				async load() {
					return [...faces];
				},
				check() {
					return true;
				},
			},
		},
	} as unknown as TypeCardOriginalWindow;
	const engine = {
		FONT: {
			mincho: '"Shippori Mincho B1"',
			dela: '"Dela Gothic One"',
			dot: '"DotGothic16"',
		},
	};
	const proof = await loadTypeCardFonts(realm, snapshots);
	const result = await proof.prove(engine, {
		mode: "quiet",
		lines: ["AB"],
		sub: "fixture",
	});
	expect(result.map((item) => item.role)).toEqual(["main", "subtitle"]);
	expect(result[0]!.sha256).toBe(
		createHash("sha256")
			.update(new Uint8Array(snapshots[0]!.bytes))
			.digest("hex"),
	);
	await expect(
		proof.prove(engine, { mode: "quiet", lines: ["AB"], weight: 400 }),
	).rejects.toThrow("exact local");
	await expect(
		proof.prove(engine, { mode: "quiet", lines: ["\u{10ffff}"] }),
	).rejects.toThrow("fallback refused");
	const extras = snapshotTypeCardFonts([
		{
			family: "Dela Gothic One",
			weight: 400,
			bytes: await fontBytes("dela-gothic-one-regular.ttf"),
		},
		{
			family: "DotGothic16",
			weight: 400,
			bytes: await fontBytes("dot-gothic-16-regular.ttf"),
		},
	]);
	const complete = await loadTypeCardFonts(realm, [...snapshots, ...extras]);
	const flicker = await complete.prove(engine, {
		mode: "flicker",
		lines: ["HELP"],
	});
	expect(
		flicker.map(({ role, family, weight, text }) => ({
			role,
			family,
			weight,
			text,
		})),
	).toEqual([
		{ role: "main", family: "Dela Gothic One", weight: 400, text: "HELP" },
		{ role: "morse-label", family: "DotGothic16", weight: 400, text: "SOS" },
	]);
	expect(
		(await complete.prove(engine, { mode: "flicker", lines: [""] }))[0]!.text,
	).toBe("\u6551\u3063\u3066");
	const customQuiet = await complete.prove(engine, {
		mode: "quiet",
		fam: "dela",
		weight: 400,
		lines: ["AB"],
		sub: "fixture",
	});
	expect(customQuiet.map(({ family, weight }) => ({ family, weight }))).toEqual(
		[
			{ family: "Dela Gothic One", weight: 400 },
			{ family: "Shippori Mincho B1", weight: 500 },
		],
	);
	const noDot = await loadTypeCardFonts(realm, [extras[0]!]);
	await expect(
		noDot.prove(engine, { mode: "flicker", lines: ["HELP"] }),
	).rejects.toThrow("DotGothic16/400");
});

test("frame admission snapshots args/beats without replacing the original beat/time semantics", () => {
	const input = fixture(),
		snapshot = snapshotTypeCardFrame(input);
	(input.args.lines as string[])[0] = "changed";
	(input.beats as number[])[0] = 0.5;
	expect(snapshot.args.lines).toEqual(["AB"]);
	expect(snapshot.beats).toEqual([0, 1, 2, 3]);
	for (const override of [
		{ time: NaN },
		{ shotStart: -1 },
		{ duration: 0 },
		{ time: 5 },
		{ beats: [2, 1] },
		{ beats: [-1] },
		{ beats: [Infinity] },
	])
		expect(() =>
			snapshotTypeCardFrame({ ...fixture(), ...override }),
		).toThrow();
	for (const override of [
		{ mode: "other" },
		{ lines: [] },
		{ fade: 0 },
		{ size: -1 },
		{ weight: 500.5 },
		{ x: Infinity },
		{ color: "red" },
		{ vertical: "yes" },
		{ fam: "serif, sans-serif" },
		{ grain: 0 },
	])
		expect(() =>
			snapshotTypeCardFrame({
				...fixture(),
				args: { ...fixture().args, ...override } as TypeCardReferenceArgs,
			}),
		).toThrow();
	expect(
		snapshotTypeCardFrame({
			...fixture(),
			args: { mode: "flicker", lines: [""] },
			beats: [],
		}).beats,
	).toEqual([]);
});
