import type {
	KanjiSlamArgs,
	KanjiSlamFrame,
} from "./mv-kanji-slam-reference-contract";
import type { createKanjiSlamReference } from "./mv-kanji-slam-reference-browser";
import {
	snapshotKanjiFrame,
	snapshotKanjiSong,
} from "./mv-kanji-slam-reference-input";
import { openKanjiRealm } from "./mv-kanji-slam-reference-realm";
import {
	loadKanjiFonts,
	loadKanjiImages,
	snapshotKanjiAssets,
	verifyKanjiAssets,
} from "./mv-kanji-slam-reference-assets";
import { pixels, check } from "./mv-afterimage-capture";

/** Separate original-only control, not a substitute oracle. Calls the unchanged
 * scene with only variant/resource IDs/fire, exercising its real SLAM defaults.
 * Frozen complete-args oracle remains untouched and must match this exactly. */
export async function createKanjiSlamDefaultsControl(
	input: Parameters<typeof createKanjiSlamReference>[0],
) {
	const song = snapshotKanjiSong(input.song),
		assets = snapshotKanjiAssets(input.fonts, input.images);
	await verifyKanjiAssets(assets);
	const original = await openKanjiRealm(input.reference),
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
		const proveFonts = await loadKanjiFonts(realm, engine, assets.fonts);
		await loadKanjiImages(realm, engine, assets.images, owned);
		await scene.init();
		const clock = engine.makeClock(song.beats, song.bpm, song.downbeatIndex0);
		return {
			dispose,
			async render(inputFrame: KanjiSlamFrame) {
				check(!disposed && !rendering, "Default control is disposed or busy");
				const frame = snapshotKanjiFrame(inputFrame);
				// The raw call intentionally omits every expanded visual option. The
				// reference contract stays strict; only this isolated original call widens it.
				const args = {
					variant: frame.args.variant,
					char: frame.args.char,
					bg: frame.args.bg,
					fire: frame.args.fire,
				};
				const rawScene = scene as unknown as {
					preload(args: Partial<KanjiSlamArgs>): string[];
					draw(
						ctx: CanvasRenderingContext2D,
						state: Record<string, unknown>,
					): unknown;
				};
				for (const id of rawScene.preload(args))
					check(engine.loaded.has(id), `Missing default-control image ${id}`);
				rendering = true;
				let canvas: HTMLCanvasElement | undefined;
				try {
					await proveFonts(frame);
					check(!disposed, "Default control disposed during font readiness");
					canvas = engine.canvas(1920, 1080);
					const ctx = canvas.getContext("2d");
					check(ctx, "Missing original default-control canvas");
					await rawScene.draw(ctx, {
						args,
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
					try {
						return {
							pixels: pixels(bitmap, 1920, 1080),
							args,
							scripts: original.scripts,
						};
					} finally {
						bitmap.close();
					}
				} finally {
					if (canvas) canvas.width = canvas.height = 1;
					rendering = false;
				}
			},
		};
	} catch (error) {
		dispose();
		throw error;
	}
}
