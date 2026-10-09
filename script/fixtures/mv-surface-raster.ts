import type { MvEmberPlan } from "../../packages/editor-contracts/src/mv-ember-plan";
import { size } from "./mv-surface-fixture";
import {
	surfaceReplaySource,
	type SurfaceMutation,
} from "./mv-surface-mutations";

export type SurfaceBackend = "worker" | "html";
export interface SurfaceBatch {
	frames: Uint8ClampedArray[];
	lifecycle: { snapshots: number[][][]; final: number[][] }[];
}
// Only this controlled harness feeds hand-authored primitive plans directly.
// Capturing dimensions does not replace any production Canvas operation.
const batchSource = String.raw`
function surfaceBatch(plans, size, createSurface) {
 const frames = [], lifecycle = [];
 for (const plan of plans) {
   const output = createSurface(size,size), ctx = output.getContext('2d'), allocated = [];
   if(!ctx) throw Error('Surface Canvas2D unavailable');
   const factory = (w,h) => { const canvas = createSurface(w,h); allocated.push(canvas); return canvas; };
   const assets = {descriptor(id){
     if(id !== 'font') throw Error('Unexpected surface fixture font');
     return {kind:'font',font:{family:'SurfaceFixture',weight:400,style:'normal',axes:{TEST:550}}};
   }};
   const steps = drawMvEmberSteps(ctx,plan,assets,factory), snapshots = [];
   try {
     while(!steps.next().done) snapshots.push(allocated.map(canvas => [canvas.width,canvas.height]));
     frames.push(ctx.getImageData(0,0,size,size).data);
     lifecycle.push({snapshots,final:allocated.map(canvas => [canvas.width,canvas.height])});
   } finally { steps.return(); output.width = output.height = 1; }
 }
 return {frames,lifecycle};
}`;

/** One batch shares its Worker/realm, exposing scratch leaks across A→B→A. */
export async function raster({
	plans,
	bytes,
	backend,
	mutation,
}: {
	plans: readonly MvEmberPlan[];
	bytes: ArrayBuffer;
	backend: SurfaceBackend;
	mutation?: SurfaceMutation;
}): Promise<SurfaceBatch> {
	const source = surfaceReplaySource(mutation) + batchSource;
	if (backend === "html") {
		const replay: (
			plans: readonly MvEmberPlan[],
			size: number,
			factory: (width: number, height: number) => HTMLCanvasElement,
		) => SurfaceBatch = new Function(`${source}; return surfaceBatch;`)();
		return replay(plans, size, (width, height) => {
			const canvas = document.createElement("canvas");
			canvas.width = width;
			canvas.height = height;
			return canvas;
		});
	}
	const workerSource =
		source +
		String.raw`
onmessage = async ({data}) => { try {
 const face = new FontFace('SurfaceFixture',data.bytes,{weight:'400',style:'normal',variationSettings:'"TEST" 550'});
 await face.load(); self.fonts.add(face);
 try {
   if(face.status !== 'loaded' || !self.fonts.has(face)) throw Error('Surface font did not load');
   const result = surfaceBatch(data.plans,data.size,(w,h) => new OffscreenCanvas(w,h));
   postMessage(result,result.frames.map(pixels => pixels.buffer));
 } finally {self.fonts.delete(face);}
 } catch(error){postMessage({error:String(error)});} };`;
	const url = URL.createObjectURL(
		new Blob([workerSource], { type: "text/javascript" }),
	);
	const worker = new Worker(url);
	try {
		return await new Promise<SurfaceBatch>((resolve, reject) => {
			const timer = setTimeout(
				() => reject(Error("Surface raster timeout")),
				15000,
			);
			worker.onerror = (event) => {
				clearTimeout(timer);
				reject(Error(event.message));
			};
			worker.onmessage = ({
				data,
			}: MessageEvent<SurfaceBatch & { error?: string }>) => {
				clearTimeout(timer);
				if (
					data.error ||
					!Array.isArray(data.frames) ||
					data.frames.length !== plans.length ||
					data.frames.some(
						(pixels) =>
							!(pixels instanceof Uint8ClampedArray) ||
							pixels.length !== size * size * 4,
					) ||
					!Array.isArray(data.lifecycle) ||
					data.lifecycle.length !== plans.length
				)
					reject(Error(data.error ?? "Missing or malformed raster frames"));
				else resolve(data);
			};
			worker.postMessage({ plans, bytes, size });
		});
	} finally {
		worker.terminate();
		URL.revokeObjectURL(url);
	}
}
