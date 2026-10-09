import type {
	ProgrammaticResource,
	ProgrammaticSource,
} from "@opencut/editor-contracts";
import { createHttpProgrammaticFrames } from "../../apps/vite-example/src/host/http-programmatic-frames";
import { renderProgrammaticCanvas } from "../../packages/editor-classic/src/services/renderer/programmatic/canvas-runtime";
import { resolveCanvasResources } from "../../packages/editor-classic/src/services/renderer/programmatic/resources";
import { resolveProgrammaticFrame } from "../../packages/editor-classic/src/services/renderer/programmatic/frame";
import { ProgrammaticNode } from "../../packages/editor-classic/src/services/renderer/nodes/programmatic-node";
import { buildTransformFromParams } from "../../packages/editor-classic/src/rendering";

const provider = createHttpProgrammaticFrames({ base: "/api" });
const signal = () => new AbortController().signal;
const equal = (actual: unknown, expected: unknown) => {
	if (JSON.stringify(actual) !== JSON.stringify(expected))
		throw Error(
			`Resource probe mismatch: ${JSON.stringify({ actual, expected })}`,
		);
};
async function rejected(run: () => Promise<unknown>, pattern: RegExp) {
	try {
		await run();
	} catch (error) {
		if (pattern.test(String(error))) return;
		throw error;
	}
	throw Error(`Expected failure: ${pattern}`);
}
async function saveImage(color: string) {
	const canvas = new OffscreenCanvas(8, 8),
		ctx = canvas.getContext("2d")!;
	ctx.fillStyle = color;
	ctx.fillRect(0, 0, 8, 8);
	const body = await (
		await canvas.convertToBlob({ type: "image/png" })
	).arrayBuffer();
	const sha256 = [
		...new Uint8Array(await crypto.subtle.digest("SHA-256", body)),
	]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
	const resource: ProgrammaticResource = {
		id: "images/card.png",
		kind: "image",
		mimeType: "image/png",
		byteLength: body.byteLength,
		sha256,
		attachmentKey: `programmatic-sha256-${sha256}`,
	};
	const metadata = {
		kind: "programmatic-resource",
		version: 1,
		mimeType: resource.mimeType,
		byteLength: body.byteLength,
		sha256,
	};
	const put = async (bytes: ArrayBuffer) => {
		const response = await fetch(`/api/attachment/${resource.attachmentKey}`, {
			method: "PUT",
			headers: { "x-opencut-metadata": btoa(JSON.stringify(metadata)) },
			body: bytes,
		});
		if (!response.ok) throw Error("Fixture attachment write failed");
	};
	await put(body);
	return { resource, body, put };
}

export async function runResourceProbe() {
	const fontPath = Reflect.get(globalThis, "__resourceFontPath");
	if (typeof fontPath !== "string")
		throw Error("Missing isolated fixture font path");
	const imported = await fetch("/api/programmatic/resources/import", {
		method: "POST",
		body: JSON.stringify({
			filePath: fontPath,
			id: "fonts/fixture.ttf",
			kind: "font",
			mimeType: "font/ttf",
			font: { family: "Rocut Resource Fixture", style: "normal", weight: 500 },
		}),
	});
	if (!imported.ok) throw Error(await imported.text());
	const font: ProgrammaticResource = (await imported.json()).resource;
	const first = await saveImage("lime"),
		second = await saveImage("blue");
	const source: ProgrammaticSource = {
		version: 1,
		runtime: "canvas-worker",
		width: 64,
		height: 64,
		frameRate: { numerator: 30, denominator: 1 },
		durationFrames: 30,
		seed: 3,
		resources: [first.resource, font],
		code: `
const c = canvas.getContext('2d');
c.drawImage(assets.image('images/card.png'), frame.index * 10, 0, 16, 32);
if (![...self.fonts].some(face => face.family.includes('Rocut Resource Fixture') && face.status === 'loaded')) throw Error('Font not loaded');
c.font = '20px "Rocut Resource Fixture"';
if (Math.abs(c.measureText('iiii').width - c.measureText('WWWW').width) > .01) throw Error('Font silently fell back');
c.fillStyle = 'red'; c.fillRect(0,48,Math.round(c.measureText('iiii').width),16);`,
	};
	const htmlCode = `<style>body{margin:0}img{position:absolute;width:16px;height:32px}canvas{position:absolute;top:48px}</style><img data-rocut-src="images/card.png"><canvas width="64" height="16"></canvas><script>window.rocut={renderFrame(frame){
document.querySelector('img').style.left=frame.index*10+'px';
if (![...document.fonts].some(face=>face.family.includes('Rocut Resource Fixture') && face.status==='loaded')) throw Error('Font not loaded');
const c=document.querySelector('canvas').getContext('2d'); c.font='20px "Rocut Resource Fixture"';
if (Math.abs(c.measureText('iiii').width-c.measureText('WWWW').width)>.01) throw Error('Font silently fell back');
c.fillStyle='red';c.fillRect(0,0,Math.round(c.measureText('iiii').width),16);
}};</script>`;
	for (const runtime of ["canvas-worker", "html-document"] as const) {
		for (const [time, image, color] of [
			[8000, first.resource, [0, 255, 0, 255]],
			[0, first.resource, [0, 255, 0, 255]],
			[8000, second.resource, [0, 0, 255, 255]],
		] as const) {
			const s = {
				...source,
				runtime,
				resources: [image, font],
				code: runtime === "canvas-worker" ? source.code : htmlCode,
			};
			const request = {
				source: s,
				clipStart: 0,
				clipDuration: 120000,
				trimStart: 0,
				timelineTime: time,
			};
			const bitmap =
				runtime === "canvas-worker"
					? await renderProgrammaticCanvas({
							source: s,
							frame: resolveProgrammaticFrame(request)!,
							resources: await resolveCanvasResources({
								resources: s.resources,
								provider,
								signal: signal(),
							}),
							signal: signal(),
						})
					: await createImageBitmap(
							await provider.renderPng({ request, signal: signal() }),
						);
			try {
				const out = new OffscreenCanvas(64, 64),
					c = out.getContext("2d")!;
				c.drawImage(bitmap, 0, 0);
				equal([...c.getImageData(time ? 24 : 8, 16, 1, 1).data], color);
				equal([...c.getImageData(time ? 8 : 24, 16, 1, 1).data], [0, 0, 0, 0]);
				equal([...c.getImageData(40, 56, 1, 1).data], [255, 0, 0, 255]);
				equal([...c.getImageData(55, 56, 1, 1).data], [0, 0, 0, 0]);
			} finally {
				bitmap.close();
			}
		}
	}
	const node = new ProgrammaticNode({
		source,
		programmaticFrames: provider,
		duration: 120000,
		timeOffset: 0,
		trimStart: 0,
		trimEnd: 0,
		opacity: 1,
		transform: buildTransformFromParams({ params: {} }),
	});
	const context = {
		renderer: { width: 64, height: 64 },
		time: 8000,
		frameRate: source.frameRate,
		videoCache: {
			getFrameAt: async () => {
				throw Error("Unexpected video access");
			},
		},
	};
	const initial = await node.resolve(context);
	if (!initial) throw Error("Missing resource-backed node");
	equal((await node.resolve(context))?.sourceVersion, initial.sourceVersion);
	node.params.source = { ...source, resources: [second.resource, font] };
	const replacement = await node.resolve(context);
	if (!replacement || replacement.sourceVersion === initial.sourceVersion)
		throw Error("Resource replacement reused stale cached frame");
	const checkCanvas = new OffscreenCanvas(64, 64),
		check = checkCanvas.getContext("2d")!;
	check.drawImage(replacement.source, 0, 0);
	equal([...check.getImageData(24, 16, 1, 1).data], [0, 0, 255, 255]);
	node.cancelPendingFrames();
	// A valid manifest pointing to damaged bytes must fail in the host, not render
	// a cached/default image. This fixture owns both content-addressed attachments.
	await first.put(new Uint8Array(first.body.byteLength).buffer);
	await rejected(
		() =>
			resolveCanvasResources({
				resources: source.resources!,
				provider,
				signal: signal(),
			}),
		/integrity mismatch/,
	);
	await rejected(
		() =>
			provider.renderPng({
				request: {
					source: { ...source, runtime: "html-document", code: htmlCode },
					clipStart: 0,
					clipDuration: 120000,
					trimStart: 0,
					timelineTime: 0,
				},
				signal: signal(),
			}),
		/integrity mismatch/,
	);
	await first.put(first.body);
	const wrongProvider = {
		renderPng: provider.renderPng,
		async loadResource() {
			return new Blob([new Uint8Array(first.body.byteLength)], {
				type: "image/png",
			});
		},
	};
	await rejected(
		() =>
			resolveCanvasResources({
				resources: [first.resource],
				provider: wrongProvider,
				signal: signal(),
			}),
		/digest mismatch/,
	);
	await rejected(
		() =>
			resolveCanvasResources({ resources: [first.resource], signal: signal() }),
		/cannot load/,
	);
	await rejected(
		() =>
			resolveCanvasResources({
				resources: [first.resource],
				provider,
				signal: AbortSignal.abort(),
			}),
		/abort/i,
	);
	return "project image/font bridge: real Worker + DOM pixels, no font fallback, seek/replacement, host/browser integrity and abort";
}
