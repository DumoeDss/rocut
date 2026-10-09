import { initializeGpu, disposeCompositor, disposeGpu } from "opencut-wasm";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import type { SessionResources } from "../../packages/editor-classic/src/editor/session/resources";
import type { VideoCache } from "../../packages/editor-classic/src/services/video-cache/service";
import type { Effect } from "../../packages/editor-classic/src/effects/types";
import { CanvasRenderer } from "../../packages/editor-classic/src/services/renderer/canvas-renderer";
import { WasmCompositor } from "../../packages/editor-classic/src/services/renderer/compositor/wasm-compositor";
import { registerDefaultEffects } from "../../packages/editor-classic/src/effects";
import { asciiThreeScene as buildScene } from "./ascii-three-scene";
import { exportAsciiThree as exportStyledScene } from "./ascii-three-export";
import {
	assertGenerator as assert,
	generatorHash,
	generatorPixels,
} from "./generator-browser-assets";
import { assertDitherAlpha, ditherContactSheet } from "./dither-three-pixels";

export async function runDitherThreeProbe() {
	const { spec, imports, effects, templateSources } = Reflect.get(
		globalThis,
		"__engineBuildSpec",
	);
	const apiBase: string = Reflect.get(globalThis, "__probeApiBase");
	const post = async (route: string, body: unknown) => {
		const response = await fetch(`${apiBase}/${route}`, {
			method: "POST",
			body: JSON.stringify(body),
		});
		if (!response.ok) throw Error(await response.text());
		return response.json();
	};
	const resources = [];
	for (const item of imports)
		resources.push(
			(await post("programmatic/resources/import", item)).resource,
		);
	const source: ProgrammaticSource = (
		await post("programmatic/build/compile", { ...spec, resources })
	).source;
	assert(
		effects.length === 1 && effects[0].type === "mono-dither",
		"Actual Creator template must select one-bit dither",
	);
	const effect = (params: Record<string, number> = {}): Effect => ({
		...effects[0],
		params: { ...effects[0].params, ...params },
	});
	const rebuild = async (inputProps: object): Promise<ProgrammaticSource> =>
		(
			await post("programmatic/build/rebuild", {
				...source,
				build: {
					...source.build,
					inputProps: { ...source.build!.inputProps, ...inputProps },
				},
			})
		).source;
	registerDefaultEffects();
	await initializeGpu();
	const compositor = new WasmCompositor({
		trackGpuResource: ({ handle, label }) => ({
			handle,
			label,
			resourceId: `dither:${handle}`,
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
	const capture = async (node: ReturnType<typeof buildScene>, time: number) => {
		console.log(`HTML probe: Dither capture ${++captures} at ${time}`);
		return renderer.renderAndCapture({
			node,
			time,
			capture: (canvas) => generatorPixels(canvas, source.width, source.height),
		});
	};
	const hash = (pixels: Uint8ClampedArray) =>
		generatorHash(new Uint8Array(pixels).buffer);
	const sample = (
		input = source,
		params: Record<string, number> = {},
		frame = 0,
		options = {},
	) =>
		capture(
			buildScene(input, [effect(params)], { apiBase, ...options }),
			12000 + frame * 4000,
		);
	try {
		const original = await capture(buildScene(source, [], { apiBase }), 12000),
			first = await sample(),
			firstHash = await hash(first);
		assert(firstHash !== (await hash(original)), "Dither is a no-op");
		assert(
			(await hash(await sample(source, { amount: 0 }))) ===
				(await hash(original)),
			"Zero amount identity",
		);
		const later = await sample(source, {}, 15),
			laterHash = await hash(later);
		assert(
			laterHash !== firstHash && (await hash(await sample())) === firstHash,
			"Three motion/reverse seek",
		);
		assert(
			(await hash(await sample(source, {}, 15, { preview: true }))) ===
				laterHash,
			"Preview/export equality",
		);
		assert(
			(await hash(await sample(source, {}, 7, { trim: 32000 }))) === laterHash,
			"Source trim mapping",
		);
		const coarse = await sample(source, { cellSize: 5 }),
			dark = await sample(source, { threshold: 0.75 }),
			flat = await sample(source, { spread: 0 });
		for (const image of [
			coarse,
			dark,
			flat,
			await sample(source, { seed: 20 }),
		])
			assert((await hash(image)) !== firstHash, "Dither parameter ignored");
		const camera = await sample(await rebuild({ cameraX: -2.5 }));
		const material = await sample(
			await rebuild({ tint: "#28aaff", roughness: 0.8 }),
		);
		const scaled = await sample(await rebuild({ scale: 0.65 }));
		for (const image of [camera, material, scaled])
			assert(
				(await hash(image)) !== firstHash,
				"Model/camera/material ignored",
			);
		const black = await sample(source, {}, 0, { background: "#000000" });
		const white = await sample(source, {}, 0, { background: "#ffffff" });
		const alpha = assertDitherAlpha(black, white, first);
		const video = await exportStyledScene(source, compositor, capture, {
			effects: [effect()],
			scene: { apiBase },
		});
		Reflect.set(
			globalThis,
			"__threePreviewBase64",
			ditherContactSheet(
				[original, first, coarse, dark, later, camera, material, scaled],
				source.width,
				source.height,
			),
		);
		assert(
			document.querySelectorAll("iframe").length === 0,
			"Scene sandbox leaked",
		);
		return {
			ok: true,
			captures,
			firstHash,
			laterHash,
			alpha,
			video,
			source,
			resources,
			effects,
			templateSources,
			checks: [
				"actual Creator ditheredThree template",
				"real offline GLB/HDR",
				"native one-bit foreground and source alpha",
				"zero identity, threshold/cell/spread/seed",
				"seek/reverse/trim",
				"camera/material/model rebuild",
				"preview/export equality",
				"real WebM encode/decode",
				"no leaked iframe",
			],
		};
	} finally {
		compositor.dispose();
		disposeGpu();
	}
}
