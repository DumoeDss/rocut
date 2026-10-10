import type { MvRoadNativePost } from "../../../../../editor-contracts/src/mv-road";
import type { ReferencePostInputs } from "./mv-reference-post";

type RoadPostSurface = HTMLCanvasElement | OffscreenCanvas;

/** Trusted native drawing only. Rust supplies the closed pass plan and ramp;
 * this executor neither resolves a look nor derives beat/colour policy. */
export function applyRoadReferencePost({
	ctx, request, createSurface, releaseSurface, check, renderReferencePost,
}: {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	request: MvRoadNativePost;
	createSurface: (width: number, height: number) => RoadPostSurface;
	releaseSurface: (canvas: RoadPostSurface) => void;
	check: () => void;
	renderReferencePost: (inputs: ReferencePostInputs) => void;
}): void {
	check();
	const plan = request?.plan;
	if (!plan || request.required !== true || request.profile !== "road-original-gl-v1" ||
		plan.profile !== request.profile || plan.songTicks !== request.songTicks ||
		plan.width !== 1920 || plan.height !== 1080 ||
		ctx.canvas.width !== plan.width || ctx.canvas.height !== plan.height ||
		!Number.isSafeInteger(request.shotStartTicks) || !Number.isSafeInteger(request.shotEndTicks) ||
		request.shotStartTicks < 0 || request.shotStartTicks >= request.shotEndTicks ||
		!["tear", "run"].includes(request.mode) || request.bloom !== 0.55 ||
		plan.lutAtlasRequired !== (request.mode === "tear"))
		throw Error("Road native post receipt mismatch");
	const comp = plan.passes[0], final = plan.passes.at(-1);
	if (comp?.shader !== "comp" || final?.shader !== "final" ||
		final.uniforms.bloom !== request.bloom || final.uniforms.fade !== 0 ||
		comp.uniforms.lutA !== 0 || comp.uniforms.lutB !== 0 ||
		comp.uniforms.lutMix !== (request.mode === "tear" ? 0.08 : 0) ||
		(request.mode === "tear" ? request.beatCA !== 0 : request.beatCA !== 2))
		throw Error("Road original post policy mismatch");
	if (request.mode === "tear") {
		if (!request.dawn || request.dawn.mix !== 0.08 || request.dawn.stops.length !== 6)
			throw Error("Road native Dawn ramp missing");
	} else if (request.dawn !== null) throw Error("Road run cannot substitute a Dawn ramp");
	const output = createSurface(plan.width, plan.height);
	let lutAtlas: RoadPostSurface | undefined;
	try {
		if (request.dawn) {
			lutAtlas = createSurface(256, 16);
			const ramp = lutAtlas.getContext("2d") as
				CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
			if (!ramp) throw Error("Road native Dawn Canvas unavailable");
			// Same native gradient endpoints and one-row fill as core/main.js.
			const gradient = ramp.createLinearGradient(0, 0, 256, 0);
			for (const [offset, color] of request.dawn.stops) gradient.addColorStop(offset, color);
			ramp.fillStyle = gradient; ramp.fillRect(0, 0, 256, 1);
		}
		check();
		renderReferencePost({ canvas: output, scene: ctx.canvas, lutAtlas, plan });
		check();
		ctx.save();
		try {
			ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
			ctx.globalCompositeOperation = "copy"; ctx.filter = "none";
			ctx.drawImage(output, 0, 0);
		} finally { ctx.restore(); }
	} finally {
		if (lutAtlas) releaseSurface(lutAtlas);
		releaseSurface(output);
	}
}

export const MV_ROAD_REFERENCE_POST_SOURCE =
	"\nconst applyRoadReferencePost = " + applyRoadReferencePost.toString() + ";\n";
