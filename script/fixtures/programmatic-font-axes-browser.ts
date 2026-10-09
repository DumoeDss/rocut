import type {
	ProgrammaticResource,
	ProgrammaticSource,
} from "@opencut/editor-contracts";
import { ProgrammaticNode } from "../../packages/editor-classic/src/services/renderer/nodes/programmatic-node";
import { buildTransformFromParams } from "../../packages/editor-classic/src/rendering";

const width = 512,
	height = 128;
const assert = (condition: unknown, label: string) => {
	if (!condition) throw Error(label);
};
const post = async (path: string, body: unknown) => {
	const response = await fetch(path, {
		method: "POST",
		body: JSON.stringify(body),
	});
	if (!response.ok) throw Error(await response.text());
	return response;
};
const provider = {
	async loadResource({ resource }: { resource: unknown }) {
		return (await post("/resource", resource)).blob();
	},
	async renderPng({ request }: { request: unknown }) {
		return (await post("/frame", request)).blob();
	},
};
const draw = `
const descriptor = assets.descriptor('font.ttf');
const face = [...fontSet].find(face => face.family === descriptor.font.family);
if (!face || face.status !== 'loaded') throw Error('Declared font is not loaded');
if (descriptor.font.axes && (!Object.isFrozen(descriptor.font.axes) || face.variationSettings === 'normal')) throw Error('Axes were dropped or left mutable');
const ctx = canvas.getContext('2d');
ctx.font = '400 64px "' + descriptor.font.family + '"';
ctx.fillStyle = 'white'; ctx.fillText('Hamburgefon', 8, 82);
ctx.fillStyle = 'red'; ctx.fillRect(8, 112, Math.round(ctx.measureText('Hamburgefon').width), 8);
ctx.fillStyle = 'blue'; ctx.fillRect(frame.index * 2, 100, 2, 4);
`;
function source(
	resource: ProgrammaticResource,
	runtime: ProgrammaticSource["runtime"],
): ProgrammaticSource {
	return {
		version: 1,
		runtime,
		width,
		height,
		frameRate: { numerator: 30, denominator: 1 },
		durationFrames: 30,
		seed: 1,
		resources: [resource],
		code:
			runtime === "canvas-worker"
				? `const fontSet = self.fonts; ${draw}`
				: `<style>html,body{margin:0;background:transparent}canvas{display:block}</style><canvas width="${width}" height="${height}"></canvas><script>window.rocut={renderFrame(frame){const canvas=document.querySelector('canvas'), assets=window.rocutResources, fontSet=document.fonts;${draw}}};</script>`,
	};
}
async function signature(image: CanvasImageSource) {
	const out = new OffscreenCanvas(width, height),
		ctx = out.getContext("2d")!;
	ctx.drawImage(image, 0, 0);
	const rgba = ctx.getImageData(0, 0, width, height).data;
	const digest = [
		...new Uint8Array(await crypto.subtle.digest("SHA-256", rgba)),
	]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
	let ink = 0,
		measuredWidth = 0;
	for (let y = 0; y < 100; y++)
		for (let x = 0; x < width; x++) ink += rgba[(y * width + x) * 4 + 3]!;
	for (let x = 0; x < width; x++)
		if (rgba[(115 * width + x) * 4 + 3]) measuredWidth++;
	assert(ink > 10000 && measuredWidth > 100, "No rendered font glyphs/metrics");
	const marker: number[] = [];
	for (let x = 0; x < width; x++) {
		const pos = (102 * width + x) * 4;
		if (
			rgba[pos] === 0 &&
			rgba[pos + 1] === 0 &&
			rgba[pos + 2] === 255 &&
			rgba[pos + 3] === 255
		)
			marker.push(x);
	}
	return { digest, ink, measuredWidth, marker };
}

async function run() {
	const resources: Record<string, ProgrammaticResource> = await (
		await fetch("/config")
	).json();
	const results: Record<string, Awaited<ReturnType<typeof signature>>> = {};
	const versions: Record<string, string[]> = {};
	const seeks: Record<
		string,
		{ frameIndex: number; pixels: Awaited<ReturnType<typeof signature>> }[]
	> = {};
	for (const runtime of ["canvas-worker", "html-document"] as const) {
		const node = new ProgrammaticNode({
			source: source(resources.low!, runtime),
			programmaticFrames: provider,
			duration: 120000,
			timeOffset: 0,
			trimStart: 0,
			trimEnd: 0,
			opacity: 1,
			transform: buildTransformFromParams({ params: {} }),
		});
		const context = {
			renderer: { width, height },
			time: 0,
			frameRate: { numerator: 30, denominator: 1 },
			videoCache: {
				getFrameAt: async () => {
					throw Error("Unexpected video");
				},
			},
		};
		versions[runtime] = [];
		for (const key of [
			"low",
			"low",
			"high",
			"low",
			"escaped",
			"static",
			...(runtime === "canvas-worker" ? ["originalLow", "originalHigh"] : []),
		]) {
			node.params.source = source(resources[key]!, runtime);
			const state = await node.resolve(context);
			assert(state, "Missing font frame");
			const pixels = await signature(state!.source);
			if (results[`${runtime}/${key}`])
				assert(
					pixels.digest === results[`${runtime}/${key}`]!.digest,
					"Resource restore is not deterministic",
				);
			results[`${runtime}/${key}`] = pixels;
			versions[runtime]!.push(state!.sourceVersion!);
		}
		assert(
			versions[runtime]![0] === versions[runtime]![1],
			"Unchanged axes should reuse the frame",
		);
		assert(
			versions[runtime]![1] !== versions[runtime]![2],
			"Changed axes reused a stale frame",
		);
		assert(
			versions[runtime]![2] !== versions[runtime]![3],
			"Restored axes reused a stale frame",
		);
		assert(
			results[`${runtime}/high`]!.ink > results[`${runtime}/low`]!.ink * 1.5,
			"Non-wght axis did not change actual glyphs",
		);
		assert(
			results[`${runtime}/escaped`]!.digest ===
				results[`${runtime}/high`]!.digest,
			"Escaped printable axis did not drive glyph variation",
		);
		node.params.source = source(resources.low!, runtime);
		seeks[runtime] = [];
		for (const frameIndex of [5, 1, 5]) {
			context.time = frameIndex * 4000;
			const state = await node.resolve(context);
			assert(state, "Missing time-seek frame");
			const pixels = await signature(state!.source);
			assert(
				JSON.stringify(pixels.marker) ===
					JSON.stringify([frameIndex * 2, frameIndex * 2 + 1]),
				"Source did not receive the Rust-mapped seek frame",
			);
			seeks[runtime]!.push({ frameIndex, pixels });
		}
		assert(
			seeks[runtime]![0]!.pixels.digest === seeks[runtime]![2]!.pixels.digest,
			"Reverse seek/repeat changed font pixels",
		);
		assert(
			seeks[runtime]![0]!.pixels.digest !== seeks[runtime]![1]!.pixels.digest,
			"Different Rust-mapped times reused stale pixels",
		);
		node.cancelPendingFrames();
	}
	for (const key of ["low", "high", "escaped", "static"])
		assert(
			results[`canvas-worker/${key}`]!.digest ===
				results[`html-document/${key}`]!.digest,
			`Canvas/HTML pixels disagree: ${key}`,
		);
	assert(
		results["canvas-worker/originalLow"]!.digest ===
			results["canvas-worker/low"]!.digest,
		"Custom axis lost native lower instance",
	);
	assert(
		results["canvas-worker/originalHigh"]!.digest ===
			results["canvas-worker/high"]!.digest,
		"Custom axis lost native upper instance",
	);
	return {
		results,
		versions,
		seeks,
		scope:
			"Real ProgrammaticNode cache, Rust frame validation, fresh Canvas Worker and Host HTML PNG, arbitrary non-wght/escaped axis, static font",
	};
}
Reflect.set(
	window,
	"rocutFontAxesResult",
	run()
		.then((value) => ({ ok: true, ...value }))
		.catch((error) => ({ error: String(error), stack: error.stack })),
);
