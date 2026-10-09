import type {
	ProgrammaticResource,
	ProgrammaticSource,
} from "@opencut/editor-contracts";
import { createHttpProgrammaticFrames } from "../../apps/vite-example/src/host/http-programmatic-frames";
import { renderProgrammaticCanvas } from "../../packages/editor-classic/src/services/renderer/programmatic/canvas-runtime";
import { resolveCanvasResources } from "../../packages/editor-classic/src/services/renderer/programmatic/resources";
import { resolveProgrammaticFrame } from "../../packages/editor-classic/src/services/renderer/programmatic/frame";

const provider = createHttpProgrammaticFrames({ base: "/api" });
const signal = () => new AbortController().signal;
function equal(actual: unknown, expected: unknown) {
	if (JSON.stringify(actual) !== JSON.stringify(expected))
		throw Error(JSON.stringify({ actual, expected }));
}

async function resource(
	kind: "model" | "environment",
	mimeType: string,
	bytes: number[],
): Promise<ProgrammaticResource> {
	const body = new Uint8Array(bytes).buffer;
	const sha256 = Array.from(
		new Uint8Array(await crypto.subtle.digest("SHA-256", body)),
		(n) => n.toString(16).padStart(2, "0"),
	).join("");
	const descriptor = {
		id: `assets/${kind}`,
		kind,
		mimeType,
		byteLength: body.byteLength,
		sha256,
		attachmentKey: `programmatic-sha256-${sha256}`,
	};
	const metadata = {
		kind: "programmatic-resource",
		version: 1,
		mimeType,
		byteLength: body.byteLength,
		sha256,
	};
	const response = await fetch(`/api/attachment/${descriptor.attachmentKey}`, {
		method: "PUT",
		headers: { "x-opencut-metadata": btoa(JSON.stringify(metadata)) },
		body,
	});
	if (!response.ok) throw Error("Fixture attachment write failed");
	return descriptor;
}

async function run() {
	// This probe tests transport/read-only semantics, not GLB or environment decoding.
	const resources = [
		await resource("model", "model/gltf-binary", [17, 43, 79, 255]),
		await resource("environment", "image/x-exr", [113, 151, 197, 255]),
	];
	const draw = `
if (frame.resourceLimits.maxBytes !== 16777216 || frame.resourceLimits.maxDecodedBytes !== 134217728) throw Error('Missing authoritative decode policy');
for (const kind of ['model', 'environment']) {
  const id = 'assets/' + kind;
  const descriptor = assets.descriptor(id);
  if (!Object.isFrozen(descriptor) || descriptor.kind !== kind || descriptor.byteLength !== 4) throw Error('Descriptor lost');
  const bytes = new Uint8Array(assets.bytes(id)); const first = bytes[0]; bytes[0] = 0;
  if (new Uint8Array(assets.bytes(id))[0] !== first) throw Error('Caller mutated stored bytes');
}
for (const name of ['bytes', 'descriptor']) {
  let denied = false; try { assets[name]('undeclared'); } catch { denied = true; }
  if (!denied) throw Error('Undeclared resource was readable');
}
const color = new Uint8Array(assets.bytes('assets/model'));
const c = canvas.getContext('2d'); c.fillStyle = 'rgb(' + [...color.slice(0,3)].join(',') + ')'; c.fillRect(frame.index * 8,0,8,16);`;
	const source: ProgrammaticSource = {
		version: 1,
		runtime: "canvas-worker",
		code: draw,
		width: 64,
		height: 64,
		frameRate: { numerator: 30, denominator: 1 },
		durationFrames: 30,
		seed: 3,
		resources,
	};
	const result = [];
	for (const runtime of ["canvas-worker", "html-document"] as const) {
		const code =
			runtime === "canvas-worker"
				? draw
				: `<style>body{margin:0}</style><canvas width="64" height="64"></canvas><script>window.rocut={renderFrame(frame){const canvas=document.querySelector('canvas');const assets=window.rocutResources;${draw}}};</script>`;
		for (const timelineTime of [8000, 0, 8000]) {
			const input = {
				source: { ...source, runtime, code },
				clipStart: 0,
				clipDuration: 120000,
				trimStart: 0,
				timelineTime,
			};
			const bitmap =
				runtime === "canvas-worker"
					? await renderProgrammaticCanvas({
							source: input.source,
							frame: resolveProgrammaticFrame(input)!,
							resources: await resolveCanvasResources({
								resources,
								provider,
								signal: signal(),
							}),
							signal: signal(),
						})
					: await createImageBitmap(
							await provider.renderPng({ request: input, signal: signal() }),
						);
			try {
				const output = new OffscreenCanvas(64, 64);
				const context = output.getContext("2d")!;
				context.drawImage(bitmap, 0, 0);
				equal(
					[...context.getImageData(timelineTime ? 20 : 4, 8, 1, 1).data],
					[17, 43, 79, 255],
				);
				equal(
					[...context.getImageData(timelineTime ? 4 : 20, 8, 1, 1).data],
					[0, 0, 0, 0],
				);
				result.push({ runtime, timelineTime, pixel: [17, 43, 79, 255] });
			} finally {
				bitmap.close();
			}
		}
	}
	return {
		ok: true,
		result,
		scope:
			"binary resource bridge only; Three decoder integration remains separate",
	};
}

void run().then(
	(result) => Reflect.set(globalThis, "__threeResourceResult", result),
	(error) =>
		Reflect.set(globalThis, "__threeResourceResult", {
			error: String(error?.stack ?? error),
		}),
);
