import type {
	KanjiSlamReference,
	KanjiSlamSong,
	KanjiSlamFont,
	KanjiSlamImage,
	KanjiSlamFrame,
} from "./mv-kanji-slam-reference-contract";
import {
	kanjiDigest,
	openKanjiRealm,
	snapshotKanjiReference,
} from "./mv-kanji-slam-reference-realm";
import {
	snapshotKanjiSong,
	snapshotKanjiFrame,
	kanjiRequiredImages,
} from "./mv-kanji-slam-reference-input";
import {
	snapshotKanjiAssets,
	verifyKanjiAssets,
	loadKanjiFonts,
	loadKanjiImages,
} from "./mv-kanji-slam-reference-assets";

/** Asset/state injection only. The entire original typo.js, private caches,
 * registration, preload, init, drawing and util.js clock stay unmodified. */
export async function createKanjiSlamReference(input: {
	reference: KanjiSlamReference;
	song: KanjiSlamSong;
	fonts: readonly KanjiSlamFont[];
	images: readonly KanjiSlamImage[];
}) {
	const reference = snapshotKanjiReference(input.reference),
		song = snapshotKanjiSong(input.song);
	const assets = snapshotKanjiAssets(input.fonts, input.images);
	await verifyKanjiAssets(assets);
	const original = await openKanjiRealm(reference),
		{ engine, realm, scene } = original;
	const owned = new Set<ImageBitmap>();
	let disposed = false,
		rendering = false;
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		for (const bitmap of owned) bitmap.close();
		owned.clear();
		for (const canvas of engine.scratch) canvas.width = canvas.height = 1;
		original.iframe.remove();
	};
	try {
		const clock = engine.makeClock(song.beats, song.bpm, song.downbeatIndex0);
		for (const name of [
			"idx",
			"since",
			"pulse",
			"downPulse",
			"phase",
			"beat",
			"bar",
			"inBar",
			"barPhase",
		] as const)
			if (typeof clock[name] !== "function")
				throw Error("Complete original kanjiSlam song clock missing");
		const proveFonts = await loadKanjiFonts(realm, engine, assets.fonts);
		const imageProof = await loadKanjiImages(
			realm,
			engine,
			assets.images,
			owned,
		);
		await scene.init();
		const songIdentity = await kanjiDigest(
			new TextEncoder().encode(JSON.stringify(song)).buffer,
		);
		return {
			dispose,
			async render(inputFrame: KanjiSlamFrame, observeText = false) {
				if (disposed || rendering)
					throw Error("kanjiSlam oracle disposed or already rendering");
				const frame = snapshotKanjiFrame(inputFrame);
				const requiredImages = kanjiRequiredImages(frame),
					preloaded = scene.preload(frame.args);
				if (
					JSON.stringify([...new Set(preloaded)]) !==
					JSON.stringify(requiredImages)
				)
					throw Error(
						"Original kanjiSlam preload differs from admitted images",
					);
				for (const id of preloaded)
					if (!engine.loaded.has(id))
						throw Error(`Missing declared kanjiSlam image: ${id}`);
				rendering = true;
				let canvas: HTMLCanvasElement | undefined;
				try {
					const fontProof = await proveFonts(frame);
					if (disposed)
						throw Error("kanjiSlam oracle disposed during font proof");
					canvas = engine.canvas(1920, 1080);
					const ctx = canvas.getContext("2d");
					if (!ctx) throw Error("Original kanjiSlam HTMLCanvas2D unavailable");
					const textCalls: string[] = [],
						nativeFillText = ctx.fillText;
					if (observeText)
						ctx.fillText = function (
							...args: Parameters<CanvasRenderingContext2D["fillText"]>
						) {
							textCalls.push(args[0]);
							return nativeFillText.apply(this, args);
						};
					await scene.draw(ctx, {
						args: frame.args,
						t: frame.time,
						lt: frame.time - frame.shotStart,
						dur: frame.duration,
						p: (frame.time - frame.shotStart) / frame.duration,
						clock,
						shot: {
							id: frame.shotId,
							t0: frame.shotStart,
							t1: frame.shotStart + frame.duration,
						},
					});
					const bitmap = await realm.createImageBitmap(canvas);
					if (disposed) {
						bitmap.close();
						throw Error("kanjiSlam oracle disposed during raster");
					}
					return {
						canvas,
						bitmap,
						textCalls,
						provenance: {
							version: 1,
							scope:
								"complete-original-kanjiSlam-preload-init-draw; excludes typo.post/gl.js",
							surface: "unaltered Z.canvas HTMLCanvasElement",
							scripts: original.scripts,
							frame,
							song,
							songIdentity,
							fonts: fontProof,
							images: imageProof,
							preloaded,
							textObserver: observeText
								? "transparent fillText forwarding; separately pixel-checked against unobserved draw"
								: "none",
							clock: {
								implementation: "unaltered util.js Z.makeClock",
								index: clock.idx(frame.time),
								phase: clock.phase(frame.time),
								since: clock.since(frame.time),
								beat: clock.beat(frame.time),
								bar: clock.bar(frame.time),
								inBar: clock.inBar(frame.time),
								barPhase: clock.barPhase(frame.time),
								pulse5: clock.pulse(frame.time, 5),
							},
						},
					};
				} catch (error) {
					if (canvas) canvas.width = canvas.height = 1;
					throw error;
				} finally {
					rendering = false;
				}
			},
		};
	} catch (error) {
		dispose();
		throw error;
	}
}
