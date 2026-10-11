import type { ProgrammaticSource } from "@opencut/editor-contracts";
import { createHttpProgrammaticFrames } from "../../apps/vite-example/src/host/http-programmatic-frames";
import { runThreeSceneExportProbe } from "./three-scene-export-probe";

const provider = createHttpProgrammaticFrames({ base: "/api" });
const post = async (route: string, input: unknown) => {
	const response = await fetch("/api/" + route, {
		method: "POST",
		body: JSON.stringify(input),
	});
	if (!response.ok) throw Error(await response.text());
	return response.json();
};
async function sample(source: ProgrammaticSource, index: number, trim = 0) {
	const step =
		(120000 * source.frameRate.denominator) / source.frameRate.numerator;
	const png = await provider.renderPng({
		request: {
			source,
			clipStart: step,
			clipDuration: 120000,
			trimStart: trim * step,
			timelineTime: step + (index - trim) * step,
		},
		signal: new AbortController().signal,
	});
	const bitmap = await createImageBitmap(png);
	const canvas = new OffscreenCanvas(source.width, source.height);
	const context = canvas.getContext("2d")!;
	try {
		context.drawImage(bitmap, 0, 0);
	} finally {
		bitmap.close();
	}
	const hash = [
		...new Uint8Array(
			await crypto.subtle.digest(
				"SHA-256",
				context.getImageData(0, 0, source.width, source.height).data,
			),
		),
	]
		.map((n) => n.toString(16).padStart(2, "0"))
		.join("");
	return {
		hash,
		pixels: (x: number, y: number) => [
			...context.getImageData(x, y, 1, 1).data,
		],
		png,
	};
}

export async function runMeshoptThreeProbe() {
	const { spec, imports } = Reflect.get(globalThis, "__engineBuildSpec");
	const resources = [];
	for (const item of imports)
		resources.push(
			(await post("programmatic/resources/import", item)).resource,
		);
	const source = (
		await post("programmatic/build/compile", { ...spec, resources })
	).source as ProgrammaticSource;
	const rebuild = async (inputProps: object) =>
		(
			await post("programmatic/build/rebuild", {
				...source,
				build: { ...source.build, inputProps },
			})
		).source as ProgrammaticSource;
	console.log("Meshopt probe: compiled pinned toolchain browser bundle");
	const frames = [];
	let first: Awaited<ReturnType<typeof sample>> | undefined;
	for (const index of [15, 0, 15]) {
		const result = await sample(source, index);
		frames.push({ index, hash: result.hash });
		if (index === 0) first = result;
	}
	if (frames[0].hash !== frames[2].hash || frames[0].hash === frames[1].hash)
		throw Error("Meshopt scene seek is not deterministic/moving");
	if (!first || first.pixels(160, 90)[3] !== 255 || first.pixels(160, 90).slice(0, 3).reduce((a, b) => a + b, 0) < 150)
		throw Error(
			"Meshopt quad missing at center: " + JSON.stringify(first?.pixels(160, 90)),
		);
	const corner = first.pixels(4, 4);
	if (corner[3] !== 0)
		throw Error("Meshopt scene lost transparent background");
	const dark = await sample(await rebuild({ dark: true }), 0);
	if (dark.hash === frames[1].hash)
		throw Error("Meshopt scene property update ignored");
	const scaled = await sample(await rebuild({ scale: 0.002 }), 0);
	if (scaled.hash === frames[1].hash || scaled.hash === dark.hash)
		throw Error("Meshopt scale update ignored");
	const extSource = await rebuild({ model: "assets/meshopt-ext.glb" });
	const extFrame = await sample(extSource, 0);
	if (extFrame.hash !== frames[1].hash)
		throw Error("EXT variant decoded differently than KHR in browser");
	console.log(
		"Meshopt probe: browser decode, determinism, props and EXT parity passed",
	);
	const exported = await runThreeSceneExportProbe(source, { assertScenePixels: false });
	const pngBytes = new Uint8Array(await first!.png.arrayBuffer());
	Reflect.set(
		globalThis,
		"__meshoptPreviewBase64",
		btoa(String.fromCharCode(...pngBytes)),
	);
	return {
		ok: true,
		frames,
		center: first!.pixels(160, 90),
		corner,
		extParity: extFrame.hash === frames[1].hash,
		decodedScope:
			"KHR_meshopt_compression v1 + EXT_meshopt_compression v0 ATTRIBUTES streams in a real browser WebGL bundle",
		...exported,
	};
}
