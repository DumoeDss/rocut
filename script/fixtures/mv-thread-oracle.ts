import type { ResolvedProgrammaticResource } from "@opencut/editor-contracts";
import {
	THREAD_REFERENCE_FILES,
	type ThreadReference,
	type ThreadSong,
	type ThreadFrame,
	type ThreadEngine,
} from "./mv-thread-contract";
import { kanjiDigest as digest } from "./mv-kanji-slam-reference-realm";

/** A private realm executes whole unchanged util/assets/draw/dark scripts. */
export async function createThreadOracle(
	reference: ThreadReference,
	inputSong: ThreadSong,
	hand: ResolvedProgrammaticResource,
) {
	const song = structuredClone(inputSong);
	if (reference.version !== 1 || reference.scripts.length !== 4)
		throw Error("Incomplete thread oracle source");
	for (const [index, source] of reference.scripts.entries()) {
		if (
			source.id !== THREAD_REFERENCE_FILES[index] ||
			(await digest(new TextEncoder().encode(source.code).buffer)) !==
				source.sha256
		)
			throw Error("Thread oracle source identity mismatch");
	}
	if (
		(await digest(hand.body)) !== hand.resource.sha256 ||
		hand.body.byteLength !== hand.resource.byteLength
	)
		throw Error("Thread oracle marker identity mismatch");
	const iframe = document.createElement("iframe");
	iframe.hidden = true;
	iframe.srcdoc = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; base-uri https://rocut-oracle.invalid"><base href="https://rocut-oracle.invalid/"><body></body>`;
	let bitmap: ImageBitmap | undefined;
	try {
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(
				() => reject(Error("Thread oracle realm timed out")),
				5000,
			);
			iframe.onload = () => {
				clearTimeout(timer);
				resolve();
			};
			iframe.onerror = () => {
				clearTimeout(timer);
				reject(Error("Thread oracle realm failed"));
			};
			document.body.append(iframe);
		});
		const realm = iframe.contentWindow as Window &
			typeof globalThis & { Z?: ThreadEngine };
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
			new Blob([hand.body], { type: hand.resource.mimeType }),
			{ premultiplyAlpha: "default", colorSpaceConversion: "none" },
		);
		if (bitmap.width !== 960 || bitmap.height !== 1600)
			throw Error("Incorrect thread marker decode dimensions");
		engine.loaded.set(hand.resource.id, bitmap);
		// Bind the original default path to the same supplied marker to prove
		// implicit original defaults; no artwork or scene body is modified.
		engine.loaded.set("assets/char/hand_reach.png", bitmap);
		engine.audio = { stops: song.stops ?? [] };
		const scene = engine.SCENES.thread!;
		const clock = engine.makeClock(song.beats, song.bpm, song.downbeatIndex0);
		let disposed = false;
		return {
			dispose() {
				if (disposed) return;
				disposed = true;
				bitmap?.close();
				iframe.remove();
			},
			render(input: ThreadFrame, implicitHand = false) {
				if (disposed) throw Error("Thread oracle already disposed");
				const frame = structuredClone(input);
				if (implicitHand) Reflect.deleteProperty(frame.args, "hand");
				const preloaded = scene.preload(frame.args);
				if (preloaded.length !== 1 || !engine.loaded.has(preloaded[0]!))
					throw Error("Unadmitted thread preload");
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
							image: hand.resource,
							scope:
								"complete unchanged dark.js thread; original util.js clock; synthetic marker, no original film artwork",
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
