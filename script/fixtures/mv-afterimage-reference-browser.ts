import {
	AFTERIMAGE_REFERENCE_TEXT,
	type AfterimageReference,
	type AfterimageReferenceFonts,
	type AfterimageReferenceFrame,
} from "./mv-afterimage-reference-contract";
import {
	loadAfterimageFonts,
	openAfterimageRealm,
	referenceDigest,
} from "./mv-afterimage-reference-realm";

const WIDTH = 1920,
	HEIGHT = 1080;

/**
 * Run inside a private browser test page. The caller supplies ONLY a synthetic
 * transparent character and three already-authorized local font byte buffers.
 * Rendering executes the full registered original draw, not a reconstructed oracle.
 */
export async function createAfterimageReference({
	reference,
	character,
	fonts,
}: {
	reference: AfterimageReference;
	character: ImageBitmapSource;
	fonts: AfterimageReferenceFonts;
}) {
	const { iframe, realm, engine, scene, scriptIdentity } =
		await openAfterimageRealm(reference);
	let characterBitmap: ImageBitmap | undefined;
	let disposed = false;
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		engine.loaded.clear();
		characterBitmap?.close();
		iframe.remove();
	};
	try {
		const fontIdentity = await loadAfterimageFonts(realm, fonts);
		characterBitmap = await realm.createImageBitmap(character);
		if (!characterBitmap.width || !characterBitmap.height)
			throw Error("Synthetic character has no pixels");
		const image = realm.document.createElement("canvas");
		image.width = characterBitmap.width;
		image.height = characterBitmap.height;
		const imageContext = image.getContext("2d");
		if (!imageContext) throw Error("Canvas2D unavailable");
		imageContext.drawImage(characterBitmap, 0, 0);
		const imagePixels = imageContext.getImageData(
			0,
			0,
			image.width,
			image.height,
		);
		let visible = false,
			transparent = false;
		for (let index = 3; index < imagePixels.data.length; index += 4) {
			visible ||= imagePixels.data[index]! > 0;
			transparent ||= imagePixels.data[index]! < 255;
		}
		if (!visible || !transparent)
			throw Error(
				"Synthetic character must have visible and transparent pixels",
			);
		const identity = {
			width: image.width,
			height: image.height,
			rgbaSha256: await referenceDigest(imagePixels.data.buffer),
		};
		engine.loaded.set(AFTERIMAGE_REFERENCE_TEXT.char, characterBitmap);
		const preload = scene.preload({ ...AFTERIMAGE_REFERENCE_TEXT });
		if (preload.length !== 1 || preload[0] !== AFTERIMAGE_REFERENCE_TEXT.char)
			throw Error("Original afterimage gained unexpected asset dependencies");
		await scene.init();
		const provenance = {
			version: 1,
			scope: "complete-original-afterimage-draw; no-gl.js-post-processing",
			width: WIDTH,
			height: HEIGHT,
			scripts: scriptIdentity,
			fonts: fontIdentity,
			character: identity,
			text: AFTERIMAGE_REFERENCE_TEXT,
			seed: 0,
			seedNote:
				"Original grain/noise constants are unchanged; no seed override",
		};
		return {
			provenance,
			dispose,
			async render(frame: AfterimageReferenceFrame) {
				if (disposed) throw Error("Afterimage reference has been disposed");
				const { time, shotStart, duration, a = {} } = frame;
				if (
					![time, shotStart, duration].every(Number.isFinite) ||
					shotStart < 0 ||
					duration <= 0 ||
					time < shotStart ||
					time > shotStart + duration
				)
					throw Error(
						"Use finite song time within the explicit nonnegative shot",
					);
				if (
					a.grain !== undefined &&
					(!Number.isFinite(a.grain) || a.grain < 0 || a.grain > 1)
				)
					throw Error("Oracle grain must be in [0, 1]");
				if (a.color !== undefined && !/^#[0-9a-f]{6}$/i.test(a.color))
					throw Error("Oracle color must be a six-digit hex color");
				const args = {
					...AFTERIMAGE_REFERENCE_TEXT,
					...(a.color === undefined ? {} : { color: a.color }),
					...(a.grain === undefined ? {} : { grain: a.grain }),
				};
				const canvas = realm.document.createElement("canvas");
				canvas.width = WIDTH;
				canvas.height = HEIGHT;
				const context = canvas.getContext("2d");
				if (!context) throw Error("Canvas2D unavailable");
				await scene.draw(context, {
					args,
					t: time,
					lt: time - shotStart,
					dur: duration,
					p: (time - shotStart) / duration,
					shot: { t0: shotStart, t1: shotStart + duration },
				});
				const png = frame.includePng
					? await new Promise<Blob>((resolve, reject) =>
							canvas.toBlob(
								(blob) =>
									blob
										? resolve(blob)
										: reject(Error("Oracle PNG encoding failed")),
								"image/png",
							),
						)
					: undefined;
				const bitmap = await realm.createImageBitmap(canvas);
				if (disposed) {
					bitmap.close();
					throw Error("Afterimage reference disposed during render");
				}
				// Caller owns returned bitmap.close(); disposal owns only the input bitmap.
				return {
					canvas,
					bitmap,
					png,
					provenance: { ...provenance, time, shotStart, duration, args },
				};
			},
		};
	} catch (error) {
		dispose();
		throw error;
	}
}
