import type { TypeCardReferenceFont } from "./mv-type-card-reference-contract";
import {
	openTypeCardRealm,
	typeCardReferenceDigest,
} from "./mv-type-card-reference-realm";
import {
	loadTypeCardFonts,
	snapshotTypeCardFonts,
} from "./mv-type-card-reference-fonts";
import { titleRiffFontIdentity } from "./mv-title-riff-reference-font-identity";
import { splitTunnelGlyphCoverage } from "./mv-tunnel-fonts";
import type { TunnelReference } from "./mv-tunnel-reference";
import type { TunnelPostReference } from "./mv-tunnel-post-reference";
import type { TunnelOracleFrame } from "./mv-tunnel-oracle";
import { snapshotTunnelInput } from "./mv-tunnel-input";
import { observeTunnelCanvas } from "./mv-tunnel-oracle-observation";
import {
	TUNNEL_FONTS,
	TUNNEL_DEFAULT_WORDS,
	TUNNEL_LATIN,
} from "./mv-tunnel-matrix";
import {
	controlledTunnelContext,
	type TunnelCanvasControl,
} from "./mv-tunnel-canvas-controls";

interface TunnelEngine {
	SCENES: {
		tunnel: {
			init(): Promise<unknown>;
			draw(ctx: CanvasRenderingContext2D, sample: unknown): void;
		};
	};
	FONT: Record<string, string>;
	clock: unknown;
	__tunnelMainReference: {
		stateFor(shot: unknown, t: number): Record<string, unknown>;
		postFor(shot: unknown, t: number): Record<string, unknown>;
	};
	makeClock(beats: readonly number[], bpm: number, offset: number): unknown;
	typo: { post: { tunnel(sample: unknown): Record<string, unknown> } };
	post: {
		init(canvas: HTMLCanvasElement): string;
		render(
			scene: HTMLCanvasElement,
			text: HTMLCanvasElement,
			post: Record<string, unknown>,
		): void;
	};
}
function object(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null;
}
function isEngine(v: unknown): v is TunnelEngine {
	return (
		object(v) &&
		object(v.SCENES) &&
		object(v.SCENES.tunnel) &&
		typeof v.SCENES.tunnel.draw === "function" &&
		typeof v.SCENES.tunnel.init === "function" &&
		typeof v.makeClock === "function" &&
		object(v.typo) &&
		object(v.typo.post) &&
		typeof v.typo.post.tunnel === "function" &&
		object(v.post) &&
		object(v.__tunnelMainReference) &&
		typeof v.__tunnelMainReference.stateFor === "function" &&
		typeof v.__tunnelMainReference.postFor === "function" &&
		typeof v.post.init === "function" &&
		typeof v.post.render === "function"
	);
}
/** Fixture-only closure: original function bytes, no boot/assets/timeline code. */
export function tunnelMainHarness(post: TunnelPostReference): string {
	if (
		post.main.id !== "core/main.js" ||
		post.main.sha256 !==
			"3f5e6ff5eb2b7a49e552f1a8da3b3cab0c48e454c226dd943d70abdd51543dd2" ||
		post.functions.length !== 2 ||
		post.functions[0]?.name !== "stateFor" ||
		post.functions[1]?.name !== "postFor" ||
		post.functions.some(
			(f) =>
				!Number.isSafeInteger(f.start) ||
				!Number.isSafeInteger(f.end) ||
				f.start < 0 ||
				f.end <= f.start ||
				post.main.code.slice(f.start, f.end) !== f.code,
		)
	)
		throw Error("Original main function source identity mismatch");
	return `(() => { 'use strict'; const Z=window.Z; const W=1920,H=1080;\n${post.functions.map((f) => f.code).join("\n")}\nZ.__tunnelMainReference=Object.freeze({stateFor,postFor}); })();`;
}
/** All original scripts, real SFNT faces and native Canvas/WebGL. No producer import.
 * Dedicated post uses original main.js stateFor/postFor + tunnelPost + gl.js; not a
 * claim for timeline/globalFX, export, or installed Electron. */
export async function createTunnelBrowserOracle({
	reference,
	postReference,
	fonts,
	onObservation,
}: {
	reference: TunnelReference;
	postReference: TunnelPostReference;
	fonts: readonly TypeCardReferenceFont[];
	onObservation?: (record: Record<string, unknown>) => void;
}) {
	const privateReference = {
		scripts: reference.scripts.map(({ id, code, sha256 }) => ({
			id,
			code,
			sha256,
		})),
	};
	const privateFonts = snapshotTypeCardFonts(fonts);
	if (
		privateFonts.some((f) => f.bytes.byteLength > 16 * 1024 * 1024) ||
		privateFonts.reduce((n, f) => n + f.bytes.byteLength, 0) > 64 * 1024 * 1024
	)
		throw Error("Tunnel encoded font byte budget exceeded");
	if (privateFonts.length !== TUNNEL_FONTS.length)
		throw Error(
			"Tunnel requires exact primary and original Noto fallback faces",
		);
	const sfntIdentities = TUNNEL_FONTS.map((role) => {
		const f = privateFonts.find(
			(f) => f.family === role.family && f.weight === role.weight,
		);
		if (!f) throw Error(`Missing tunnel ${role.family}/${role.weight}`);
		return {
			family: f.family,
			weight: f.weight,
			descriptor: { weight: String(f.weight), style: "normal" },
			byteLength: f.bytes.byteLength,
			sfnt: titleRiffFontIdentity(f.bytes, f.family, f.weight),
		};
	});
	const post = structuredClone(postReference);
	if (
		post.id !== "core/gl.js" ||
		(await typeCardReferenceDigest(
			new TextEncoder().encode(post.code).buffer,
		)) !== post.sha256 ||
		(await typeCardReferenceDigest(
			new TextEncoder().encode(post.main.code).buffer,
		)) !== post.main.sha256 ||
		(
			await Promise.all(
				post.functions.map(
					async (f) =>
						(await typeCardReferenceDigest(
							new TextEncoder().encode(f.code).buffer,
						)) === f.sha256,
				),
			)
		).some((valid) => !valid)
	)
		throw Error("Original GL source identity mismatch");
	const opened = await openTypeCardRealm({
		version: 1,
		scripts: privateReference.scripts,
	});
	const { realm, iframe } = opened;
	let disposed = false;
	const canvases = new Set<HTMLCanvasElement>();
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		for (const c of canvases) c.width = c.height = 1;
		for (const c of opened.engine.scratch) c.width = c.height = 1;
		iframe.remove();
	};
	try {
		const script = realm.document.createElement("script");
		script.textContent = post.code + "\n" + tunnelMainHarness(post);
		let scriptError: Error | undefined;
		const onError = (e: ErrorEvent) => {
			scriptError = Error(e.message);
			e.preventDefault();
		};
		realm.addEventListener("error", onError);
		try {
			realm.document.body.append(script);
			if (scriptError) throw scriptError;
		} finally {
			realm.removeEventListener("error", onError);
		}
		const engine: unknown = Reflect.get(realm, "Z");
		if (!isEngine(engine))
			throw Error("Original full tunnel/GL did not register");
		// This dedicated shot has no section look or timeline-wide globalFX.
		for (const key of ["sectionAt", "LOOK_DEFAULT", "LOOKS", "globalFX"])
			Reflect.deleteProperty(engine, key);
		const proof = await loadTypeCardFonts(realm, privateFonts);
		const faceIdentities = await Promise.all(
			sfntIdentities.map(async (identity) => {
				const f = privateFonts.find(
					(f) => f.family === identity.family && f.weight === identity.weight,
				)!;
				return { ...identity, sha256: await typeCardReferenceDigest(f.bytes) };
			}),
		);
		await engine.SCENES.tunnel.init();
		const allocate = () => {
			const c = realm.document.createElement("canvas");
			c.width = 1920;
			c.height = 1080;
			canvases.add(c);
			return c;
		};
		const output = allocate(),
			text = allocate();
		const renderer = engine.post.init(output);
		const gl = output.getContext("webgl2");
		if (
			!gl ||
			!gl.getExtension("EXT_color_buffer_float") ||
			gl.getError() !== gl.NO_ERROR
		)
			throw Error("Original full-float WebGL post initialization failed");
		return {
			dispose,
			async render({
				frame: input,
				control,
				postControl,
			}: {
				frame: TunnelOracleFrame;
				control?: TunnelCanvasControl;
				postControl?: string;
			}) {
				if (disposed) throw Error("Tunnel original realm disposed");
				const frame = snapshotTunnelInput(input);
				const words = frame.args.words ?? TUNNEL_DEFAULT_WORDS;
				if (
					!Array.isArray(words) ||
					!words.every((w: unknown) => typeof w === "string")
				)
					throw Error("Invalid admitted words");
				const plan = frame.args.plan;
				const planWords = Array.isArray(plan)
					? plan.map((p: unknown) =>
							Array.isArray(p) && typeof p[1] === "string" ? p[1] : "",
						)
					: [];
				const uses = [
					{
						mode: "quiet" as const,
						lines: [words.join("") + planWords.join("") + "　・"],
						fam: "mincho",
						weight: 800,
					},
					{
						mode: "quiet" as const,
						lines: [TUNNEL_LATIN.join("") + "   ·   "],
						fam: "dot",
						weight: 400,
					},
					{
						mode: "quiet" as const,
						lines: [words.at(-1)!],
						fam: "minchoHeavy",
						weight: 900,
					},
				];
				const fontIdentity = (
					await Promise.all(
						uses.map(async (a) => {
							const mapped = engine.FONT[a.fam]?.replace(/^"|"$/g, "");
							if (!mapped) throw Error("Missing original font mapping");
							const { primaryText, fallbackText } = splitTunnelGlyphCoverage({
								fonts: privateFonts,
								family: mapped,
								weight: a.weight,
								text: a.lines[0]!,
							});
							const identities = await proof.prove(engine, {
								...a,
								lines: [primaryText],
							});
							if (fallbackText)
								identities.push(
									...(await proof.prove(engine, {
										...a,
										fam: "serif",
										lines: [fallbackText],
									})),
								);
							return identities.map((id) => ({
								...id,
								requestedFamily: mapped,
								fallback: id.family !== mapped,
							}));
						}),
					)
				).flat();
				if (disposed)
					throw Error("Tunnel oracle disposed during native font admission");
				const canvas = allocate(),
					ctx = canvas.getContext("2d");
				if (!ctx) throw Error("Native Canvas2D unavailable");
				const metrics: {
					mincho800: Record<string, number>;
					dot400: Record<string, number>;
				} = { mincho800: {}, dot400: {} };
				for (const [key, use] of [
					["mincho800", uses[0]!],
					["dot400", uses[1]!],
				] as const) {
					ctx.font = `${use.weight} 100px ${engine.FONT[use.fam]}, "Noto Serif JP", serif`;
					for (const ch of new Set([...use.lines[0]!])) {
						const w = ctx.measureText(ch).width;
						if (!Number.isFinite(w) || w < 0)
							throw Error("Invalid native advance");
						metrics[key][ch] = w;
					}
				}
				ctx.font = "10px sans-serif";
				const cacheIdentity = await typeCardReferenceDigest(
					new TextEncoder().encode(
						JSON.stringify({
							args: frame.args,
							beats: frame.beats,
							bpm: frame.bpm,
							downbeat: frame.downbeatIndex0,
						}),
					).buffer,
				);
				engine.clock = engine.makeClock(
					frame.beats,
					frame.bpm,
					frame.downbeatIndex0,
				);
				const shot = {
					id: cacheIdentity,
					t0: frame.shotStart,
					t1: frame.shotStart + frame.duration,
					args: frame.args,
					post: (s: unknown) => engine.typo.post.tunnel(s),
				};
				const sample = engine.__tunnelMainReference.stateFor(shot, frame.time);
				try {
					if (disposed)
						throw Error(
							"Tunnel oracle disposed during source identity admission",
						);
					const observed = onObservation ? observeTunnelCanvas(ctx) : undefined;
					const before = observed?.state();
					engine.SCENES.tunnel.draw(
						controlledTunnelContext({ ctx: observed?.ctx ?? ctx, control }),
						sample,
					);
					onObservation?.({ cacheIdentity, metrics, before, after: observed?.state(),
						commands: observed?.records,
						sample: { t: sample.t, lt: sample.lt, dur: sample.dur, shotKeys: Object.keys(shot) },
						fontSetStatus: realm.document.fonts.status,
						fontFaces: [...realm.document.fonts].map(face => ({ family: face.family, weight: face.weight, status: face.status })),
					});
					const pixels = ctx.getImageData(0, 0, 1920, 1080).data;
					const renderPost = engine.__tunnelMainReference.postFor(
						shot,
						frame.time,
					);
					const resolvedPost = { ...renderPost };
					const dedicatedPost = engine.typo.post.tunnel(sample);
					applyPostControl({ p: renderPost, name: postControl });
					engine.post.render(canvas, text, renderPost);
					if (gl.getError() !== gl.NO_ERROR)
						throw Error("Original GL post reported a native error");
					const read = allocate(),
						readCtx = read.getContext("2d");
					if (!readCtx) throw Error("Post readback unavailable");
					readCtx.drawImage(output, 0, 0);
					const postPixels = readCtx.getImageData(0, 0, 1920, 1080).data;
					canvases.delete(read);
					read.width = read.height = 1;
					return {
						pixels,
						postPixels,
						post: dedicatedPost,
						metrics,
						provenance: {
							frame,
							cacheIdentity,
							scripts: opened.scriptIdentity,
							postScript: { id: post.id, sha256: post.sha256 },
							mainScript: { id: post.main.id, sha256: post.main.sha256 },
							resolvedPost,
							mainFunctions: post.functions.map(
								({ name, start, end, sha256 }) => ({
									name,
									start,
									end,
									sha256,
								}),
							),
							fonts: fontIdentity,
							sfntFaces: faceIdentities,
							renderer,
							scope:
								"complete-original-tunnel+original-main-stateFor/postFor+dedicated-tunnel-post-through-full-original-gl; no section/globalFX/timeline/export",
						},
					};
				} finally {
					canvases.delete(canvas);
					canvas.width = canvas.height = 1;
				}
			},
		};
	} catch (e) {
		dispose();
		throw e;
	}
}
function applyPostControl({
	p,
	name,
}: {
	p: Record<string, unknown>;
	name?: string;
}) {
	if (!name) return;
	switch (name) {
		case "no-bloom":
			p.bloom = 0;
			break;
		case "no-zoom-blur":
			p.zoomBlur = 0;
			break;
		case "no-boil":
			p.boil = 0;
			break;
		case "no-post-vignette":
			p.vignette = 0;
			break;
		case "wrong-settle":
			p.zoomBlur = 0.058;
			break;
		case "wrong-center":
			p.zoomCenter = [0.2, 0.8];
			break;
		default:
			throw Error("Unknown dedicated post negative");
	}
}
