import type { ResolvedProgrammaticResource } from "@opencut/editor-contracts";
import {
	FALL_REFERENCE_FILES,
	type FallReference,
	type FallSong,
	type FallFrame,
	type FallEngine,
} from "./mv-fall-contract";
import { kanjiDigest as digest } from "./mv-kanji-slam-reference-realm";

/** A private realm executes whole unchanged util/assets/draw/dark scripts. */
export async function createFallOracle(
	reference: FallReference,
	inputSong: FallSong,
	character: ResolvedProgrammaticResource,
) {
	const song = structuredClone(inputSong);
	if (reference.version !== 1 || reference.scripts.length !== 4)
		throw Error("Incomplete fall oracle source");
	for (const [index, source] of reference.scripts.entries()) {
		if (
			source.id !== FALL_REFERENCE_FILES[index] ||
			(await digest(new TextEncoder().encode(source.code).buffer)) !==
				source.sha256
		)
			throw Error("Fall oracle source identity mismatch");
	}
	if (
		(await digest(character.body)) !== character.resource.sha256 ||
		character.body.byteLength !== character.resource.byteLength
	)
		throw Error("Fall oracle marker identity mismatch");
	const iframe = document.createElement("iframe");
	iframe.hidden = true;
	iframe.srcdoc = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; base-uri https://rocut-oracle.invalid"><base href="https://rocut-oracle.invalid/"><body></body>`;
	let bitmap: ImageBitmap | undefined;
	try {
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(
				() => reject(Error("Fall oracle realm timed out")),
				5000,
			);
			iframe.onload = () => {
				clearTimeout(timer);
				resolve();
			};
			iframe.onerror = () => {
				clearTimeout(timer);
				reject(Error("Fall oracle realm failed"));
			};
			document.body.append(iframe);
		});
		const realm = iframe.contentWindow as Window &
			typeof globalThis & { Z?: FallEngine };
		let failed: string | undefined;
		realm.addEventListener("error", (event: ErrorEvent) => {
			failed = event.message;
			event.preventDefault();
		});
		for (const source of reference.scripts) {
			const script = realm.document.createElement("script");
			script.textContent = source.code;
			realm.document.body.append(script);
			if (failed) throw Error(`Complete original script failed: ${failed}`);
		}
		const engine = realm.Z;
		if (
			!engine ||
			["thread", "fall", "flame", "ink"].some((key) => !engine.SCENES[key])
		)
			throw Error("Missing complete dark.js registrations");
		bitmap = await realm.createImageBitmap(
			new Blob([character.body], { type: character.resource.mimeType }),
			{ premultiplyAlpha: "default", colorSpaceConversion: "none" },
		);
		if (bitmap.width !== 960 || bitmap.height !== 1600)
			throw Error("Incorrect fall marker decode dimensions");
		engine.loaded.set(character.resource.id, bitmap);
		// Bind the original default path to the same supplied marker to prove
		// implicit original defaults; no artwork or scene body is modified.
		engine.loaded.set("assets/char/fall.png", bitmap);
		engine.audio = { stops: song.stops ?? [] };
		const scene = engine.SCENES.fall!;
		const clock = engine.makeClock(song.beats, song.bpm, song.downbeatIndex0);
		let disposed = false;
		return {
			dispose() {
				if (disposed) return;
				disposed = true;
				bitmap?.close();
				iframe.remove();
			},
			render(input: FallFrame, implicitChar = false) {
				if (disposed) throw Error("Fall oracle already disposed");
				const frame = structuredClone(input);
				if (implicitChar) Reflect.deleteProperty(frame.args, "char");
				const preloaded = scene.preload(frame.args);
				if (preloaded.length !== 1 || !engine.loaded.has(preloaded[0]!))
					throw Error("Unadmitted fall preload");
				const canvas = engine.canvas(1920, 1080);
				const ctx = canvas.getContext("2d")!;
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
							scripts: reference.scripts.map(({ id, sha256 }) => ({
								id,
								sha256,
							})),
							frame,
							song,
							image: character.resource,
							scope:
								"complete unchanged dark.js fall; original util.js clock; synthetic marker, no original film artwork",
						},
					};
				} catch (error) {
					canvas.width = canvas.height = 1;
					throw error;
				}
			},
		};
	} catch (error) {
		bitmap?.close();
		iframe.remove();
		throw error;
	}
}
