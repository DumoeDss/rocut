import type {
	TitleRiffReference,
	TitleRiffSong,
	TitleRiffFont,
	TitleRiffImage,
	TitleRiffReferenceFrame,
	TitleRiffEngine,
	TitleRiffClock,
} from "./mv-title-riff-reference-contract";
import {
	openConvergeRealm,
	convergeReferenceDigest,
} from "./mv-converge-reference-realm";
import {
	snapshotTitleRiffSong,
	snapshotTitleRiffFrame,
	titleRiffRequiredImages,
} from "./mv-title-riff-reference-input";
import {
	snapshotTitleRiffAssets,
	verifyTitleRiffAssetHashes,
	loadTitleRiffImages,
} from "./mv-title-riff-reference-assets";
import { loadTitleRiffFonts } from "./mv-title-riff-reference-fonts";

export type TitleRiffArcObserver = (
	ctx: CanvasRenderingContext2D,
	args: Parameters<CanvasRenderingContext2D["arc"]>,
) => void;

/** Full original intro/outro, including scratch composition, textures and recap.
 * Only asset/state injection; no source extraction, patched formulas, fake clocks
 * or OffscreenCanvas substitution. A new realm owns each immutable song snapshot.
 */
export async function createTitleRiffReference(input: {
	reference: TitleRiffReference;
	song: TitleRiffSong;
	fonts: readonly TitleRiffFont[];
	images: readonly TitleRiffImage[];
}) {
	const song = snapshotTitleRiffSong(input.song),
		assets = snapshotTitleRiffAssets(input.fonts, input.images);
	await verifyTitleRiffAssetHashes(assets);
	const original = await openConvergeRealm(input.reference);
	original.iframe.title =
		"Isolated complete original titleRiff intro/outro oracle";
	const engine = original.engine as TitleRiffEngine,
		owned = new Set<ImageBitmap>();
	let disposed = false;
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		for (const image of owned) image.close();
		owned.clear();
		for (const canvas of engine.scratch ?? []) canvas.width = canvas.height = 1;
		original.iframe.remove();
	};
	try {
		const scene = engine.SCENES.titleRiff;
		if (!scene || !engine.loaded || !engine.FONT)
			throw Error("Complete original titleRiff engine did not register");
		engine.audio = { beats: [...song.beats] };
		engine.CREDIT = song.credit;
		const clock = engine.makeClock(
			song.beats,
			song.bpm,
			song.downbeatIndex0,
		) as TitleRiffClock;
		for (const field of [
			"idx",
			"since",
			"pulse",
			"phase",
			"beat",
			"bar",
			"inBar",
			"barPhase",
		] as const)
			if (typeof clock[field] !== "function")
				throw Error("Original complete song clock missing");
		engine.clock = clock;
		engine.scratch = [engine.canvas(1920, 1080)];
		const proveFonts = await loadTitleRiffFonts(
			original.realm,
			engine,
			assets.fonts,
		);
		const imageProof = await loadTitleRiffImages(
			original.realm,
			engine,
			assets.images,
			owned,
		);
		await scene.init();
		const songIdentity = await convergeReferenceDigest(
			new TextEncoder().encode(JSON.stringify(song)).buffer,
		);
		return {
			dispose,
			async render(
				inputFrame: TitleRiffReferenceFrame,
				observe?: (
					ctx: CanvasRenderingContext2D,
					text: string,
					x: number,
					y: number,
				) => void,
				observeArc?: TitleRiffArcObserver,
			) {
				if (disposed) throw Error("titleRiff oracle disposed");
				const frame = snapshotTitleRiffFrame(inputFrame);
				for (const id of titleRiffRequiredImages(frame))
					if (!engine.loaded.has(id))
						throw Error(`Missing declared titleRiff image: ${id}`);
				const fontProof = await proveFonts(frame, song);
				const canvas = engine.canvas(1920, 1080),
					ctx = canvas.getContext("2d");
				if (!ctx) throw Error("Original titleRiff HTMLCanvas2D unavailable");
				const prototype = original.realm.CanvasRenderingContext2D.prototype,
					fillText = prototype.fillText,
					arc = prototype.arc;
				if (observe)
					prototype.fillText = function (
						...args: Parameters<CanvasRenderingContext2D["fillText"]>
					) {
						observe(this, args[0], args[1], args[2]);
						return fillText.apply(this, args);
					};
				if (observeArc)
					prototype.arc = function (
						...args: Parameters<CanvasRenderingContext2D["arc"]>
					) {
						const result = arc.apply(this, args);
						observeArc(this, args);
						return result;
					};
				try {
					await scene.draw(ctx, {
						args: frame.args,
						t: frame.time,
						lt: frame.time - frame.shotStart,
						dur: frame.duration,
						p: (frame.time - frame.shotStart) / frame.duration,
						clock,
						shot: { t0: frame.shotStart, t1: frame.shotStart + frame.duration },
					});
					const bitmap = await original.realm.createImageBitmap(canvas);
					if (disposed) {
						bitmap.close();
						throw Error("titleRiff oracle disposed during render");
					}
					return {
						canvas,
						bitmap,
						provenance: {
							version: 1,
							scope:
								"complete-original-titleRiff-intro-outro-draw; excludes INTRO.post/gl.js",
							surface: "unaltered Z.canvas HTMLCanvasElement",
							scripts: original.scripts,
							frame,
							song,
							songIdentity,
							fonts: fontProof,
							images: imageProof,
							clock: {
								implementation: "unaltered util.js Z.makeClock",
								index: clock.idx(frame.time),
								phase: clock.phase(frame.time),
								since: clock.since(frame.time),
								beat: clock.beat(frame.time),
								bar: clock.bar(frame.time),
								inBar: clock.inBar(frame.time),
								barPhase: clock.barPhase(frame.time),
								pulse9: clock.pulse(frame.time, 9),
							},
						},
					};
				} catch (error) {
					canvas.width = canvas.height = 1;
					throw error;
				} finally {
					if (observe) prototype.fillText = fillText;
					if (observeArc) prototype.arc = arc;
				}
			},
		};
	} catch (error) {
		dispose();
		throw error;
	}
}
