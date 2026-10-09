import { initializeGpu, disposeCompositor, disposeGpu } from "opencut-wasm";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import type { SessionResources } from "../../packages/editor-classic/src/editor/session/resources";
import type { VideoCache } from "../../packages/editor-classic/src/services/video-cache/service";
import { CanvasRenderer } from "../../packages/editor-classic/src/services/renderer/canvas-renderer";
import { WasmCompositor } from "../../packages/editor-classic/src/services/renderer/compositor/wasm-compositor";
import { registerDefaultEffects } from "../../packages/editor-classic/src/effects";
import { asciiEffect, asciiThreeScene } from "./ascii-three-scene";
import {
	assertGenerator as assert,
	generatorHash,
	generatorPixels,
} from "./generator-browser-assets";
import { exportAsciiThree } from "./ascii-three-export";

const post = async (route: string, body: unknown) => {
	const response = await fetch(`/api/${route}`, {
		method: "POST",
		body: JSON.stringify(body),
	});
	if (!response.ok) throw Error(await response.text());
	return response.json();
};
export async function runAsciiThreeProbe() {
	const { spec, imports } = Reflect.get(globalThis, "__engineBuildSpec"),
		resources = [];
	for (const item of imports)
		resources.push(
			(await post("programmatic/resources/import", item)).resource,
		);
	const source: ProgrammaticSource = (
		await post("programmatic/build/compile", { ...spec, resources })
	).source;
	const rebuild = async (inputProps: object) =>
		(
			await post("programmatic/build/rebuild", {
				...source,
				build: { ...source.build, inputProps },
			})
		).source as ProgrammaticSource;
	console.log(
		"HTML probe: compiled textured cube scene for ASCII styling",
	);
	registerDefaultEffects();
	await initializeGpu();
	const compositor = new WasmCompositor({
		trackGpuResource: ({ handle, label }) => ({
			handle,
			label,
			resourceId: `ascii:${handle}`,
			release: () => disposeCompositor(handle),
		}),
	} as SessionResources);
	const renderer = new CanvasRenderer({
		width: source.width,
		height: source.height,
		fps: source.frameRate,
		compositor,
		videoCache: { getFrameAt: async () => null } as unknown as VideoCache,
	});
	let captures = 0;
	const capture = async (
		node: ReturnType<typeof asciiThreeScene>,
		time: number,
	) => {
		console.log(`HTML probe: ASCII capture ${captures + 1} at ${time}`);
		return renderer.renderAndCapture({
			node,
			time,
			capture: (canvas) => {
				captures++;
				return generatorPixels(canvas, source.width, source.height);
			},
		});
	};
	const hash = (data: Uint8ClampedArray) =>
		generatorHash(new Uint8Array(data).buffer);
	const sample = async (
		input: ProgrammaticSource,
		params: Record<string, number> = {},
		frame = 0,
		options = {},
	) =>
		capture(
			asciiThreeScene(input, [asciiEffect(params)], options),
			12000 + frame * 4000,
		);
	try {
		const baseline = await capture(asciiThreeScene(source, []), 12000),
			first = await sample(source),
			firstHash = await hash(first);
		assert(
			(await hash(baseline)) !== firstHash,
			"ASCII Three effect is a no-op",
		);
		assert(
			(await hash(await sample(source, { amount: 0 }))) ===
				(await hash(baseline)),
			"ASCII zero amount differs from original model",
		);
		const later = await sample(source, {}, 15),
			laterHash = await hash(later);
		assert(
			laterHash !== firstHash &&
				(await hash(await sample(source))) === firstHash,
			"ASCII model motion or reverse seek failed",
		);
		assert(
			(await hash(await sample(source, {}, 15, { preview: true }))) ===
				laterHash,
			"ASCII preview/export graph differs",
		);
		assert(
			(await hash(await sample(source, {}, 7, { trim: 32000 }))) === laterHash,
			"ASCII source trim changed time",
		);
		const mono = await sample(source, { color: 0 }),
			coarse = await sample(source, { cellSize: 24 });
		assert(
			(await hash(mono)) !== firstHash && (await hash(coarse)) !== firstHash,
			"ASCII palette/cell parameters ignored",
		);
		assert(
			(await hash(await sample(source, { seed: 41 }))) !== firstHash,
			"ASCII density seed ignored",
		);
		const cameraSource = await rebuild({ cameraX: -2.5 }),
			camera = await sample(cameraSource);
		const materialSource = await rebuild({ tint: "#28aaff", roughness: 0.8 }),
			material = await sample(materialSource);
		const scaledSource = await rebuild({ scale: 0.65 }),
			scaled = await sample(scaledSource);
		assert(
			(await hash(camera)) !== firstHash &&
				(await hash(material)) !== firstHash &&
				(await hash(scaled)) !== firstHash,
			"ASCII discarded camera/material/model changes",
		);
		// Final scene frames intentionally clear opaque. Recover foreground alpha
		// from independent black/white composites, then verify two other backgrounds.
		// Raw glyph alpha is also asserted pixel-by-pixel by ascii_gpu.rs.
		const black = await sample(source, {}, 0, { background: "#000000" }),
			white = await sample(source, {}, 0, { background: "#ffffff" }),
			light = await sample(source, {}, 0, { background: "#eeeeee" });
		let transparentPixels = 0,
			partialPixels = 0,
			blendError = 0;
		for (let p = 0; p < black.length; p += 4) {
			const transmission = white[p] - black[p];
			if (transmission === 255) transparentPixels++;
			if (transmission >= 25 && transmission <= 235) partialPixels++;
			for (let c = 0; c < 3; c++) {
				blendError = Math.max(
					blendError,
					Math.abs(white[p + c] - black[p + c] - transmission),
					Math.abs(
						first[p + c] -
							(black[p + c] + ([16, 32, 48][c] * transmission) / 255),
					),
					Math.abs(light[p + c] - (black[p + c] + (238 * transmission) / 255)),
				);
			}
		}
		assert(
			transparentPixels > source.width * source.height * 0.1 &&
				partialPixels > 100 &&
				blendError < 4,
			`ASCII alpha composite ${JSON.stringify({ transparentPixels, partialPixels, blendError })}`,
		);
		const sheet = document.createElement("canvas");
		sheet.width = 1280;
		sheet.height = 360;
		const ctx = sheet.getContext("2d")!;
		document.body.append(sheet);
		for (const [index, data] of [
			baseline,
			first,
			mono,
			coarse,
			later,
			camera,
			material,
			scaled,
		].entries()) {
			const tile = new OffscreenCanvas(source.width, source.height);
			tile
				.getContext("2d")!
				.putImageData(
					new ImageData(
						new Uint8ClampedArray(data),
						source.width,
						source.height,
					),
					0,
					0,
				);
			ctx.drawImage(
				tile,
				(index % 4) * 320,
				Math.floor(index / 4) * 180,
				320,
				180,
			);
		}
		const video = await exportAsciiThree(source, compositor, capture);
		Reflect.set(
			globalThis,
			"__threePreviewBase64",
			sheet.toDataURL("image/png").split(",")[1],
		);
		assert(
			document.querySelectorAll("iframe").length === 0,
			"ASCII scene sandbox leaked",
		);
		return {
			ok: true,
			captures,
			firstHash,
			laterHash,
			cameraHash: await hash(camera),
			materialHash: await hash(material),
			transparentPixels,
			partialPixels,
			blendError,
			video,
			source,
			resources,
			checks: [
				"real offline textured GLB cube and HDR",
				"native ASCII glyphs",
				"zero identity",
				"color/cell/seed",
				"seek/trim",
				"camera/material/model rebuild",
				"transparent and partial alpha over dark/light backgrounds",
				"preview/export equality",
				"real WebM encode/decode",
			],
		};
	} finally {
		compositor.dispose();
		disposeGpu();
	}
}
