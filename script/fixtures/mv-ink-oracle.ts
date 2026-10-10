import type {
	InkFrame,
	InkImage,
	InkReference,
	InkSong,
} from "./mv-ink-contract";
import { openInkRealm, validateInkIdentities } from "./mv-ink-oracle-realm";
import { validateInkContext } from "./mv-ink-source";

export async function createInkOracle({
	reference: inputReference,
	song: inputSong,
	images: inputImages,
}: {
	reference: InkReference;
	song: InkSong;
	images: readonly InkImage[];
}) {
	const reference = structuredClone(inputReference),
		song = structuredClone(inputSong);
	const images = inputImages.map((image) => ({
		...image,
		body: image.body.slice(0),
	}));
	// Original innerRim caches by dimensions, not identity. A resource swap
	// needs a fresh realm, preserving original caches without stale oracle art.
	if (images.length !== 1)
		throw Error("Ink oracle requires one character per fresh realm");
	await validateInkIdentities({ reference, images });
	const realm = await openInkRealm({ reference, images });
	try {
		const { engine } = realm,
			scene = engine.SCENES.ink;
		if (!scene) throw Error("Original Ink missing");
		const clock = engine.makeClock(song.beats, song.bpm, song.downbeatIndex0);
		return {
			dispose: realm.dispose,
			render(input: InkFrame) {
				if (realm.isDisposed()) throw Error("Original Ink realm disposed");
				const frame = structuredClone(input);
				validateInkContext({ frame, song });
				const preload = scene.preload(frame.args);
				if (
					preload.length !== 1 ||
					preload[0] !== frame.args.char ||
					frame.args.char !== images[0]!.id ||
					!engine.loaded.has(frame.args.char)
				)
					throw Error("Ink requires an explicitly admitted character");
				const canvas = engine.canvas(1920, 1080),
					ctx = canvas.getContext("2d");
				if (!ctx) throw Error("Ink original 2D context unavailable");
				try {
					scene.draw(ctx, {
						args: frame.args,
						t: frame.time,
						lt: frame.time - frame.shotStart,
						dur: frame.duration,
						p: (frame.time - frame.shotStart) / frame.duration,
						shot: { t0: frame.shotStart, t1: frame.shotStart + frame.duration },
						clock,
					});
					return {
						canvas,
						pixels: ctx.getImageData(0, 0, 1920, 1080).data,
						provenance: {
							frame,
							song,
							scripts: reference.scripts.map(({ id, sha256 }) => ({
								id,
								sha256,
							})),
							images: images.map(({ body: _body, ...identity }) => identity),
							scope:
								"Full unchanged original Ink; original caches, makeClock, nine authored tendrils and all compositing; full-frame 1920x1080 with only original internal reduced passes",
						},
					};
				} catch (error) {
					canvas.width = canvas.height = 1;
					throw error;
				}
			},
		};
	} catch (error) {
		realm.dispose();
		throw error;
	}
}
