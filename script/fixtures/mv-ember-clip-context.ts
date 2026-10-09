import type { MvEmberPlan } from "../../packages/editor-contracts/src/mv-ember-plan";
import type { EmberReferenceAsset } from "./mv-ember-reference-contract";
import { check, clipPixels } from "./mv-ember-clip-input";
import { clipReplaySource } from "./mv-ember-clip-replay";

export interface ClipContextCase {
	label: string;
	settings?: CanvasRenderingContext2DSettings;
	transferred?: readonly ("output" | "layer")[];
	layered?: boolean;
}
export const CLIP_CONTEXT_CASES: readonly ClipContextCase[] = [
	{ label: "worker-context-default" },
	{ label: "worker-read-frequent", settings: { willReadFrequently: true } },
	{ label: "worker-read-infrequent", settings: { willReadFrequently: false } },
	{ label: "worker-desynchronized", settings: { desynchronized: true } },
	{ label: "worker-synchronized", settings: { desynchronized: false } },
	{
		label: "worker-read-frequent-desynchronized",
		settings: { willReadFrequently: true, desynchronized: true },
	},
	{
		label: "worker-read-infrequent-desynchronized",
		settings: { willReadFrequently: false, desynchronized: true },
	},
	{ label: "transfer-output-direct", transferred: ["output"], layered: false },
	{ label: "transfer-output-only-layered", transferred: ["output"] },
	{ label: "transfer-layer-only", transferred: ["layer"] },
	{ label: "transfer-output-and-layer", transferred: ["output", "layer"] },
	{
		label: "transfer-output-and-layer-read-frequent",
		transferred: ["output", "layer"],
		settings: { willReadFrequently: true },
	},
	{
		label: "transfer-output-and-layer-read-infrequent",
		transferred: ["output", "layer"],
		settings: { willReadFrequently: false },
	},
	{
		label: "transfer-output-and-layer-desynchronized",
		transferred: ["output", "layer"],
		settings: { desynchronized: true },
	},
];

/** Only the empty surface allocation/context settings vary. All asset decode,
 * plan replay and clip operations still execute inside the dedicated Worker. */
export function clipContextSource() {
	let source = clipReplaySource("baseline");
	for (const [before, after] of [
		[
			"const out = new OffscreenCanvas(w, h), ctx = out.getContext('2d');",
			"const out = clipDiagnosticSurface('layer',w,h), ctx = out.getContext('2d');",
		],
		[
			"const canvas = new OffscreenCanvas(...size); allocated.push(canvas); return canvas;",
			"const canvas = clipDiagnosticSurface('scratch',...size); allocated.push(canvas); return canvas;",
		],
	]) {
		check(
			source.split(before).length === 2,
			`Ambiguous context diagnostic replacement: ${before}`,
		);
		source = source.replace(before, after);
	}
	return (
		source +
		String.raw`
let clipSurfaceFactory;
function clipDiagnosticSurface(role,width,height) {
  return clipSurfaceFactory(role,width,height);
}
onmessage = async ({data}) => {
  const allocated = [], attributes = [], remaining = new Map(data.transferred);
  let image;
  try {
    clipSurfaceFactory = (role,width,height) => {
      const transferred = remaining.get(role);
      if (transferred) remaining.delete(role);
      const canvas = transferred || new OffscreenCanvas(width,height);
      if (canvas.width !== width || canvas.height !== height) throw Error('Transferred surface geometry mismatch');
      allocated.push(canvas);
      const ctx = canvas.getContext('2d',data.settings || {});
      if (!ctx) throw Error('Diagnostic 2D context unavailable');
      attributes.push({role,width,height,transferred:!!transferred,actual:ctx.getContextAttributes()});
      return canvas;
    };
    image = await createImageBitmap(new Blob([data.asset.body],{type:data.asset.mimeType}));
    const assets = {
      image(id) { if (id !== data.asset.id) throw Error('Unexpected image'); return image; },
      descriptor(id) { if (id !== data.asset.id) throw Error('Unexpected descriptor'); return {kind:'image'}; }
    };
    const canvas = clipDiagnosticSurface('output',1920,1080);
    if (data.layered) renderMvRecipe(canvas,data.root,assets);
    else drawMvEmber(canvas.getContext('2d'),data.root.root.data,assets);
    if (remaining.size) throw Error('Transferred surface not consumed');
    const bitmap = canvas.transferToImageBitmap();
    postMessage({bitmap,attributes},[bitmap]);
  } catch (error) { postMessage({error:String(error),attributes}); }
  finally {
    if (image) image.close();
    for (const canvas of allocated) canvas.width = canvas.height = 1;
    for (const canvas of remaining.values()) canvas.width = canvas.height = 1;
  }
};`
	);
}

export async function replayContextWorker(
	plan: MvEmberPlan,
	asset: EmberReferenceAsset,
	test: ClipContextCase,
) {
	const placeholders: HTMLCanvasElement[] = [];
	const url = URL.createObjectURL(
		new Blob([clipContextSource()], { type: "text/javascript" }),
	);
	let worker: Worker | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const transferred = (test.transferred ?? []).map((role) => {
			const placeholder = document.createElement("canvas");
			placeholder.width = 1920;
			placeholder.height = 1080;
			placeholders.push(placeholder);
			// The broker never obtains a context or runs any author/render code.
			return [role, placeholder.transferControlToOffscreen()] as const;
		});
		worker = new Worker(url);
		const activeWorker = worker;
		const result = await new Promise<{
			bitmap?: ImageBitmap;
			attributes: unknown[];
			error?: string;
		}>((resolve, reject) => {
			timer = setTimeout(
				() => reject(Error("Context diagnostic Worker timed out")),
				20000,
			);
			activeWorker.onerror = (event) => reject(Error(event.message));
			activeWorker.onmessage = ({ data }) => resolve(data);
			activeWorker.postMessage(
				{
					asset,
					transferred,
					settings: test.settings,
					layered: test.layered !== false,
					root: {
						version: 1,
						root: { kind: "ember", role: "foreground", data: plan },
						outputRoles: ["foreground"],
						post: [],
					},
				},
				transferred.map(([, canvas]) => canvas),
			);
		});
		if (!(result.bitmap instanceof ImageBitmap))
			return {
				error: result.error || "Missing diagnostic bitmap",
				attributes: result.attributes,
			};
		try {
			return {
				pixels: clipPixels(result.bitmap),
				attributes: result.attributes,
			};
		} finally {
			result.bitmap.close();
		}
	} catch (error) {
		return { error: String(error), attributes: [] };
	} finally {
		clearTimeout(timer);
		worker?.terminate();
		URL.revokeObjectURL(url);
		// A transferred placeholder cannot be resized from the broker.
		for (const placeholder of placeholders) placeholder.remove();
	}
}
