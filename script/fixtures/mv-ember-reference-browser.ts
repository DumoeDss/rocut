import type {
	EmberAudioFacts,
	EmberOriginalEngine,
	EmberReference,
	EmberReferenceAsset,
	EmberReferenceFrame,
} from "./mv-ember-reference-contract";
import {
	snapshotEmberAudio,
	snapshotEmberFrame,
} from "./mv-ember-reference-input";
import {
	loadEmberAssets,
	snapshotEmberAsset,
} from "./mv-ember-reference-assets";
import {
	openConvergeRealm,
	convergeReferenceDigest,
} from "./mv-converge-reference-realm";

/** Both scenes live in the same full original intro.js bundle. Reuse only its
 * verified realm loader, never the production renderer or its scene formulas.
 * A new realm per audio snapshot isolates upstream beat/collapse-key caches.
 */
export async function createEmberReference(input: {
	reference: EmberReference;
	audio: EmberAudioFacts;
	font?: EmberReferenceAsset;
	images?: readonly EmberReferenceAsset[];
}) {
	const audio = snapshotEmberAudio(input.audio);
	const font = input.font ? snapshotEmberAsset(input.font) : undefined;
	const images = (input.images ?? []).map(snapshotEmberAsset);
	if (images.length > 64) throw Error("Too many Ember oracle images");
	const original = await openConvergeRealm(input.reference);
	original.iframe.title = "Isolated complete original Ember oracle";
	const owned = new Set<ImageBitmap>();
	let disposed = false;
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		for (const bitmap of owned) bitmap.close();
		owned.clear();
		original.iframe.remove();
	};
	try {
		const engine = original.engine as EmberOriginalEngine;
		if (
			typeof engine.makeEnv !== "function" ||
			!engine.loaded ||
			!engine.SCENES.ember
		)
			throw Error(
				"Complete original Ember, makeEnv and assets did not register",
			);
		engine.audio = {
			beats: [...audio.beats],
			onsets_strong: audio.strongOnsets,
		};
		const clock = engine.makeClock(audio.beats, 120, 0);
		const env = engine.makeEnv(audio.envelopes);
		engine.clock = clock;
		await loadEmberAssets({
			realm: original.realm,
			engine,
			font,
			images,
			owned,
		});
		const scene = engine.SCENES.ember;
		await scene.init();
		const audioIdentity = await convergeReferenceDigest(
			new TextEncoder().encode(JSON.stringify(audio)).buffer,
		);
		return {
			dispose,
			async render(inputFrame: EmberReferenceFrame) {
				if (disposed) throw Error("Ember oracle disposed");
				const frame = snapshotEmberFrame(inputFrame);
				const { args, time, shotStart, duration } = frame;
				if (args.mode !== "collapse" && !font)
					throw Error("Original Ember HUD requires explicit real font bytes");
				if (args.mode === "collapse" && !engine.loaded.has(args.bg))
					throw Error(
						"Original Ember collapse requires its declared image; no silent omission",
					);
				const canvas = engine.canvas(1920, 1080),
					ctx = canvas.getContext("2d");
				if (!ctx) throw Error("Ember oracle Canvas2D unavailable");
				try {
					await scene.draw(ctx, {
						args,
						t: time,
						lt: time - shotStart,
						dur: duration,
						p: (time - shotStart) / duration,
						clock,
						env,
						shot: { t0: shotStart, t1: shotStart + duration },
					});
					const bitmap = await original.realm.createImageBitmap(canvas);
					if (disposed) {
						bitmap.close();
						throw Error("Ember oracle disposed during render");
					}
					return {
						canvas,
						bitmap,
						provenance: {
							version: 1,
							scope: "complete-original-ember-draw; no-gl.js-post-processing",
							scripts: original.scripts,
							frame,
							audioIdentity,
							font: font
								? {
										id: font.id,
										sha256: font.sha256,
										profile: "DotGothic16 normal 400",
									}
								: null,
							images: images.map((image) => ({
								id: image.id,
								sha256: image.sha256,
								width: engine.loaded.get(image.id)!.width,
								height: engine.loaded.get(image.id)!.height,
							})),
							clock: {
								implementation: "unaltered util.js Z.makeClock",
								since: clock.since(time),
								pulse9: clock.pulse(time, 9),
							},
							envelope: {
								implementation: "unaltered util.js Z.makeEnv",
								rms: env.rms(time),
								mid: env.mid(time),
								vocal: env.vocal(time),
							},
						},
					};
				} catch (error) {
					canvas.width = canvas.height = 1;
					throw error;
				}
			},
		};
	} catch (error) {
		dispose();
		throw error;
	}
}
