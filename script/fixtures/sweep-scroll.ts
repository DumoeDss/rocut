import { generatorCapture } from "./generator-capture";
import { exportGenerators } from "./generator-export-probe";
import { assertGenerator as assert } from "./generator-browser-assets";
import { sweepScrollAssets } from "./sweep-scroll-assets";
import { sweepScrollChecks } from "./sweep-scroll-checks";
import { checkSweepScrollComposite } from "./sweep-scroll-composite";

export async function runSweepScrollProbe() {
	const { resources, image } = await sweepScrollAssets();
	const { capture, count } = generatorCapture(resources);
	const { sources, images, evidence } = await sweepScrollChecks(
		capture,
		resources,
		image,
	);
	const overlay = await checkSweepScrollComposite(sources, resources, image);
	const sheet = document.createElement("canvas");
	sheet.width = 384;
	sheet.height = 324;
	const ctx = sheet.getContext("2d")!;
	images.forEach((pixels, i) =>
		ctx.putImageData(
			new ImageData(new Uint8ClampedArray(pixels), 192, 108),
			(i % 2) * 192,
			Math.floor(i / 2) * 108,
		),
	);
	document.body.append(sheet);
	const sheetData = sheet.toDataURL("image/png"),
		media = [];
	for (const [index, name] of [
		"ascii-sweep",
		"particle-scroll",
		"overlay",
	].entries()) {
		Reflect.deleteProperty(globalThis, "__stylizedVideoBase64");
		Reflect.deleteProperty(globalThis, "__stylizedExpectedBase64");
		let video;
		try {
			video = await exportGenerators(
				index === 2 ? sources : [sources[index]],
				resources,
			);
		} finally {
			const bytes = Reflect.get(globalThis, "__stylizedVideoBase64"),
				expected = Reflect.get(globalThis, "__stylizedExpectedBase64");
			if (typeof bytes === "string" && typeof expected === "string") {
				media.push({
					name,
					video: bytes,
					expected,
					sheet: sheetData,
					evidence: video,
				});
				Reflect.set(globalThis, "__sweepScrollMedia", media);
			}
		}
		assert(video, `${name} export artifacts missing`);
	}
	return {
		ok: true,
		captures: count(),
		...evidence,
		overlay,
		exports: media.map(({ name, evidence }) => ({ name, ...evidence })),
		checks: [
			"independent font/text/band oracle",
			"fixed source UV/geometry/alpha particle oracle",
			"both ASCII and four particle scan directions",
			"parameter and seed changes",
			"repeat/reverse/ref/trim/rational frame mapping",
			"role filtering and missing resources",
			"independent timeline overlay oracle",
			"three six-frame WebM exports with preview parity",
		],
	};
}
