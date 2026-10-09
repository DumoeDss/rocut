import type { ProgrammaticSource } from "@opencut/editor-contracts";
import { createHttpProgrammaticFrames } from "../../apps/vite-example/src/host/http-programmatic-frames";
import { runThreeSceneExportProbe } from "./three-scene-export-probe";

const provider = createHttpProgrammaticFrames({ base: "/api" });
const controller = () => new AbortController();
const post = async (route: string, input: unknown) => {
	const response = await fetch(`/api/${route}`, {
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
		signal: controller().signal,
	});
	const bitmap = await createImageBitmap(png),
		canvas = new OffscreenCanvas(source.width, source.height),
		context = canvas.getContext("2d")!;
	try {
		context.drawImage(bitmap, 0, 0);
	} finally {
		bitmap.close();
	}
	const image = context.getImageData(0, 0, source.width, source.height);
	const hash = [
		...new Uint8Array(await crypto.subtle.digest("SHA-256", image.data)),
	]
		.map((n) => n.toString(16).padStart(2, "0"))
		.join("");
	const pixels = (x: number, y: number) => [
		...context.getImageData(x, y, 1, 1).data,
	];
	return { hash, pixels, png };
}

export async function runThreeSceneProbe() {
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
	console.log(
		"HTML probe: compiled pinned Three scene with offline attachments",
	);
	const frames = [];
	let first: Awaited<ReturnType<typeof sample>> | undefined;
	for (const index of [15, 0, 15]) {
		const result = await sample(source, index);
		frames.push({ index, hash: result.hash });
		if (index === 0) first = result;
	}
	if (frames[0].hash !== frames[2].hash || frames[0].hash === frames[1].hash)
		throw Error("Three seek is not deterministic/moving");
	if (!first || first.pixels(2, 2).some((n) => n !== 0))
		throw Error("Three canvas lost transparent background");
	const opaque = first.pixels(75, 72),
		half = first.pixels(220, 76);
	if (opaque[3] !== 255 || half[3] < 120 || half[3] > 136)
		throw Error(`GLB/alpha missing: ${JSON.stringify({ opaque, half })}`);
	if ((await sample(source, 15, 8)).hash !== frames[0].hash)
		throw Error("Three trimmed frame mapping changed pixels");
	const fractional = (
		await post("programmatic/build/compile", {
			...spec,
			resources,
			frameRate: { numerator: 24000, denominator: 1001 },
		})
	).source as ProgrammaticSource;
	const fractionalFirst = await sample(fractional, 0);
	const fractionalLater = await sample(fractional, 15);
	if (
		fractionalFirst.hash !== first.hash ||
		fractionalLater.hash === frames[0].hash ||
		(await sample(fractional, 15, 8)).hash !== fractionalLater.hash
	)
		throw Error(
			"Fractional-rate Three frame mapping ignored source time or trim",
		);
	const exr = await sample(
		await rebuild({ environment: "assets/neutral.exr" }),
		0,
	);
	if (exr.hash !== first.hash)
		throw Error("Equivalent uniform HDR/EXR changed pixels");
	const dark = await sample(await rebuild({ intensity: 0 }), 0);
	if (
		dark
			.pixels(75, 72)
			.slice(0, 3)
			.reduce((a, b) => a + b, 0) > 10 ||
		opaque.slice(0, 3).reduce((a, b) => a + b, 0) < 40
	)
		throw Error(
			`Environment did not illuminate PBR model: ${JSON.stringify({ opaque, dark: dark.pixels(75, 72) })}`,
		);
	const smaller = await sample(await rebuild({ scale: 0.5 }), 0);
	if (smaller.hash === first.hash)
		throw Error("Scene parameter update ignored");
	let tinyRejected = false;
	try {
		await sample(await rebuild({ environment: "assets/tiny.hdr" }), 0);
	} catch (error) {
		if (!/at least 64x32/.test(String(error))) throw error;
		tinyRejected = true;
	}
	if (!tinyRejected)
		throw Error("Undersized environment silently rendered a black model");
	const stalled = await rebuild({ stall: true }),
		abort = controller();
	const pending = provider.renderPng({
		request: {
			source: stalled,
			clipStart: 0,
			clipDuration: 120000,
			trimStart: 0,
			timelineTime: 0,
		},
		signal: abort.signal,
	});
	const timer = setTimeout(() => abort.abort(), 1200);
	let cancelled = false;
	try {
		await pending;
	} catch (error) {
		if (!/abort|cancel/i.test(String(error))) throw error;
		cancelled = true;
	} finally {
		clearTimeout(timer);
	}
	if (!cancelled) throw Error("Cancelled Three scene published success");
	if ((await sample(source, 0)).hash !== first.hash)
		throw Error("Three capture did not recover after cancellation");
	console.log(
		"HTML probe: GLB textures/instances, HDR/EXR, alpha, seek/trim, props and abort recovery passed",
	);
	const exported = await runThreeSceneExportProbe(source);
	const pngBytes = new Uint8Array(await first.png.arrayBuffer());
	Reflect.set(
		globalThis,
		"__threePreviewBase64",
		btoa(String.fromCharCode(...pngBytes)),
	);
	return {
		ok: true,
		frames,
		opaque,
		half,
		environmentEquivalent: exr.hash === first.hash,
		fractionalRate: {
			numerator: 24000,
			denominator: 1001,
			frame15Hash: fractionalLater.hash,
		},
		decodedScope: "GLB/PNG/HDR/uncompressed EXR",
		...exported,
	};
}
