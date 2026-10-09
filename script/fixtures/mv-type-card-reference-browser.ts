import type {
	TypeCardReference,
	TypeCardReferenceFont,
	TypeCardReferenceFrame,
} from "./mv-type-card-reference-contract";
import {
	loadTypeCardFonts,
	snapshotTypeCardFonts,
} from "./mv-type-card-reference-fonts";
import { snapshotTypeCardFrame } from "./mv-type-card-reference-frame";
import {
	openTypeCardRealm,
	typeCardReferenceDigest,
} from "./mv-type-card-reference-realm";

/** Test-only full original typeCard draw. No production renderer participates. */
export async function createTypeCardReference({
	reference,
	fonts,
}: {
	reference: TypeCardReference;
	fonts: readonly TypeCardReferenceFont[];
}) {
	const fontBytes = snapshotTypeCardFonts(fonts);
	const { iframe, realm, engine, scene, scriptIdentity } =
		await openTypeCardRealm(reference);
	let disposed = false;
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		for (const canvas of engine.scratch) {
			canvas.width = 0;
			canvas.height = 0;
		}
		iframe.remove();
	};
	try {
		const fontProof = await loadTypeCardFonts(realm, fontBytes);
		await scene.init();
		return {
			dispose,
			async render(input: TypeCardReferenceFrame) {
				if (disposed) throw Error("typeCard reference has been disposed");
				const frame = snapshotTypeCardFrame(input);
				const { args, time, shotStart, duration, beats } = frame;
				const fontIdentity = await fontProof.prove(engine, args);
				// The original beat cache key contains shot.id but not the beat array.
				// Include beat content so independent oracle cases cannot reuse stale beats.
				const beatIdentity = await typeCardReferenceDigest(
					new TextEncoder().encode(JSON.stringify(beats)).buffer,
				);
				if (disposed)
					throw Error("typeCard reference disposed during font admission");
				const canvas = engine.canvas(1920, 1080),
					context = canvas.getContext("2d");
				if (!context) throw Error("Canvas2D unavailable");
				await scene.draw(context, {
					args,
					t: time,
					lt: time - shotStart,
					dur: duration,
					p: (time - shotStart) / duration,
					clock: { beats },
					shot: { id: beatIdentity, t0: shotStart, t1: shotStart + duration },
				});
				const png = frame.includePng
					? await new Promise<Blob>((resolve, reject) =>
							canvas.toBlob(
								(blob) =>
									blob
										? resolve(blob)
										: reject(Error("typeCard oracle PNG encoding failed")),
								"image/png",
							),
						)
					: undefined;
				const bitmap = await realm.createImageBitmap(canvas);
				if (disposed) {
					bitmap.close();
					throw Error("typeCard reference disposed during render");
				}
				// Caller owns bitmap.close(). Native canvas remains unscaled.
				return {
					canvas,
					bitmap,
					png,
					provenance: {
						version: 1,
						scope: "complete-original-typeCard-draw; no-gl.js-post-processing",
						width: 1920,
						height: 1080,
						scripts: scriptIdentity,
						fonts: fontIdentity,
						fontNote:
							"Caller-supplied exact SFNT bytes and declared fixture weights; not an assertion of upstream font asset identity",
						seedNote:
							"Original grain, glitch and noise constants unchanged; no seed override",
						time,
						shotStart,
						duration,
						beats,
						beatIdentity,
						args,
					},
				};
			},
		};
	} catch (error) {
		dispose();
		throw error;
	}
}
