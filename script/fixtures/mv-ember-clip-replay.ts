import { MV_RECIPE_RENDERER_SOURCE } from "../../packages/editor-classic/src/services/renderer/programmatic/mv-recipe-renderer";
import { MV_EMBER_RENDERER_SOURCE } from "../../packages/editor-classic/src/services/renderer/programmatic/mv-ember-renderer";
import type { MvEmberPlan } from "../../packages/editor-contracts/src/mv-ember-plan";
import type { EmberReferenceAsset } from "./mv-ember-reference-contract";
import { check, clipPixels } from "./mv-ember-clip-input";
import { createHtmlClipMasks } from "./mv-ember-clip-html-masks";

export type ClipVariant =
	| "baseline"
	| "cover-save"
	| "clip-default"
	| "keep-clip-ctm"
	| "all-state"
	| "decode-none"
	| "image-mask"
	| "image-and-rect-mask"
	| "html-coverage-mask"
	| "image-mask-source-in"
	| "image-pattern";

/** In-memory diagnostic mutations only. Exact replacement guards fail closed
 * when production changes; the unmodified baseline is always rendered first. */
export function clipReplaySource(variant: ClipVariant) {
	let source = MV_EMBER_RENDERER_SOURCE;
	const replace = (before: string, after: string) => {
		check(
			source.split(before).length === 2,
			`Ambiguous diagnostic replacement: ${before}`,
		);
		source = source.replace(before, after);
	};
	if (variant === "image-pattern") {
		replace(
			"if (command.clip) {",
			`if (command.kind === 'image' && command.clip) {
        if (command.composite !== 'source-over') throw Error('Pattern diagnostic requires source-over');
        const img = assets.image(command.image);
        const pattern = target.createPattern(img,'no-repeat');
        if (!pattern) throw Error('Image pattern unavailable');
        mvEmberTransform(target,command.clip); mvEmberPath(target,command.clip.path);
        mvEmberTransform(target,command);
        target.translate(command.destinationRect[0],command.destinationRect[1]);
        target.scale(command.destinationRect[2]/img.width,command.destinationRect[3]/img.height);
        target.globalAlpha = command.opacity; target.globalCompositeOperation = 'source-over';
        target.imageSmoothingEnabled = command.smoothing; target.imageSmoothingQuality = command.smoothingQuality;
        target.fillStyle = pattern; target.fill('nonzero');
        return;
      }
      if (command.clip) {`,
		);
	}
	if (
		variant === "image-mask" ||
		variant === "image-mask-source-in" ||
		variant === "image-and-rect-mask" ||
		variant === "html-coverage-mask"
	) {
		replace(
			"const allocated = [], scratch = new Map();",
			"const allocated = [], scratch = new Map(); let imageMask;",
		);
		replace(
			"if (command.clip) {",
			`if (command.kind === 'image' && command.clip) {
        if (command.composite !== 'source-over') throw Error('Image-mask diagnostic requires source-over');
        if (assets.descriptor(command.image).kind !== 'image') throw Error('Expected declared image');
        if (!imageMask) imageMask = make([target.canvas.width,target.canvas.height]);
        const sx = imageMask.getContext('2d');
        if (!sx) throw Error('Image-mask diagnostic requires Canvas2D');
        sx.save();
        try {
          sx.setTransform(1,0,0,1,0,0);
          initialize(sx); sx.globalAlpha = 1; sx.globalCompositeOperation = 'source-over';
          // Reuse storage, never pixels from the preceding annular slice.
          sx.clearRect(0,0,imageMask.width,imageMask.height);
          mvEmberTransform(sx,command);
          sx.imageSmoothingEnabled = command.smoothing; sx.imageSmoothingQuality = command.smoothingQuality;
          sx.drawImage(assets.image(command.image),...command.destinationRect);
          mvEmberTransform(sx,command.clip); mvEmberPath(sx,command.clip.path);
          sx.globalCompositeOperation = 'destination-in'; sx.globalAlpha = 1;
          sx.fillStyle = 'rgba(255,255,255,1)'; sx.fill('nonzero');
        } finally { sx.restore(); }
        // Never mask the existing destination layer. Only the new image is
        // attenuated; transparent scratch pixels leave destination RGBA alone.
        target.setTransform(1,0,0,1,0,0);
        target.globalCompositeOperation = 'source-over'; target.globalAlpha = command.opacity;
        target.drawImage(imageMask,0,0);
        return;
      }
      if (command.clip) {`,
		);
		if (variant === "image-mask-source-in") {
			replace(
				`mvEmberTransform(sx,command);
          sx.imageSmoothingEnabled = command.smoothing; sx.imageSmoothingQuality = command.smoothingQuality;
          sx.drawImage(assets.image(command.image),...command.destinationRect);
          mvEmberTransform(sx,command.clip); mvEmberPath(sx,command.clip.path);
          sx.globalCompositeOperation = 'destination-in'; sx.globalAlpha = 1;
          sx.fillStyle = 'rgba(255,255,255,1)'; sx.fill('nonzero');`,
				`mvEmberTransform(sx,command.clip); mvEmberPath(sx,command.clip.path);
          sx.fillStyle = 'rgba(255,255,255,1)'; sx.fill('nonzero');
          mvEmberTransform(sx,command);
          sx.globalCompositeOperation = 'source-in';
          sx.imageSmoothingEnabled = command.smoothing; sx.imageSmoothingQuality = command.smoothingQuality;
          sx.drawImage(assets.image(command.image),...command.destinationRect);`,
			);
		}
		if (variant === "image-and-rect-mask" || variant === "html-coverage-mask") {
			replace(
				"if (command.kind === 'image' && command.clip) {",
				"if ((command.kind === 'image' || command.kind === 'rect') && command.clip) {",
			);
			replace(
				"if (command.composite !== 'source-over') throw Error('Image-mask diagnostic requires source-over');",
				"if (command.kind === 'image' && command.composite !== 'source-over') throw Error('Image-mask diagnostic requires source-over');",
			);
			replace(
				"if (assets.descriptor(command.image).kind !== 'image') throw Error('Expected declared image');",
				"if (command.kind === 'image' && assets.descriptor(command.image).kind !== 'image') throw Error('Expected declared image');",
			);
			replace(
				`sx.imageSmoothingEnabled = command.smoothing; sx.imageSmoothingQuality = command.smoothingQuality;
          sx.drawImage(assets.image(command.image),...command.destinationRect);`,
				`if (command.kind === 'image') {
            sx.imageSmoothingEnabled = command.smoothing; sx.imageSmoothingQuality = command.smoothingQuality;
            sx.drawImage(assets.image(command.image),...command.destinationRect);
          } else mvEmberPaint(sx,{...command.paint,composite:'source-over',opacity:1},command.rect);`,
			);
			replace(
				"target.globalCompositeOperation = 'source-over'; target.globalAlpha = command.opacity;",
				"target.globalCompositeOperation = command.kind === 'image' ? 'source-over' : command.paint.composite; target.globalAlpha = command.kind === 'image' ? command.opacity : command.paint.opacity;",
			);
		}
		if (variant === "html-coverage-mask") {
			replace(
				`mvEmberTransform(sx,command.clip); mvEmberPath(sx,command.clip.path);
          sx.globalCompositeOperation = 'destination-in'; sx.globalAlpha = 1;
          sx.fillStyle = 'rgba(255,255,255,1)'; sx.fill('nonzero');`,
				`const coverage = assets.clipMask(command);
          sx.setTransform(1,0,0,1,0,0);
          sx.globalCompositeOperation = 'destination-in'; sx.globalAlpha = 1;
          sx.drawImage(coverage,0,0);`,
			);
		}
	}
	if (variant === "cover-save" || variant === "all-state") {
		replace(
			"for (const operation of command.operations || []) {",
			`const operations = command.operations || [];
  for (let index = 0; index < operations.length; index++) {
    if (command.kind === 'image' && index === operations.length - 1) {
      if (operations[index].kind !== 'translate') throw Error('Expected final D.cover translate');
      ctx.save();
    }
    const operation = operations[index];`,
		);
		replace(
			"target.drawImage(assets.image(command.image),...command.destinationRect);",
			"target.drawImage(assets.image(command.image),...command.destinationRect); target.restore();",
		);
	}
	if (variant === "clip-default" || variant === "all-state")
		replace("target.clip('nonzero');", "target.clip();");
	if (variant === "keep-clip-ctm" || variant === "all-state") {
		replace(
			"function mvEmberTransform(ctx, command) {",
			"function mvEmberTransform(ctx, command, keepBase = false) {",
		);
		replace(
			"ctx.setTransform(...command.transform);",
			"if (!keepBase) ctx.setTransform(...command.transform);",
		);
		replace(
			"mvEmberTransform(target,command);",
			`if (command.clip && (command.clip.operations?.length ||
        JSON.stringify(command.clip.transform) !== '[1,0,0,1,0,0]' ||
        JSON.stringify(command.transform) !== '[1,0,0,1,0,0]'))
        throw Error('Identity-CTM diagnostic precondition failed');
      mvEmberTransform(target,command,!!command.clip);`,
		);
	}
	check(
		MV_RECIPE_RENDERER_SOURCE.split(MV_EMBER_RENDERER_SOURCE).length === 2,
		"Expected exactly one Ember raster in production recipe renderer",
	);
	return MV_RECIPE_RENDERER_SOURCE.replace(MV_EMBER_RENDERER_SOURCE, source);
}

const rootPlan = (plan: MvEmberPlan) => ({
	version: 1,
	root: { kind: "ember", role: "foreground", data: plan },
	outputRoles: ["foreground"],
	post: [],
});

export function replayMain(
	plan: MvEmberPlan,
	image: ImageBitmap,
	kind: "html" | "offscreen",
	layered = false,
) {
	const canvas =
		kind === "html"
			? document.createElement("canvas")
			: new OffscreenCanvas(1920, 1080);
	canvas.width = 1920;
	canvas.height = 1080;
	const renderer = new Function(
		`${clipReplaySource("baseline")}\nreturn { draw: drawMvEmber, recipe: renderMvRecipe };`,
	)();
	const assets = { image: () => image, descriptor: () => ({ kind: "image" }) };
	try {
		if (layered) renderer.recipe(canvas, rootPlan(plan), assets);
		else renderer.draw(canvas.getContext("2d"), plan, assets);
		return clipPixels(canvas);
	} finally {
		canvas.width = canvas.height = 1;
	}
}

const WORKER_ENTRY = String.raw`
onmessage = async ({data}) => {
  let image, canvas;
  const clipMasks = new Map(data.clipMasks || []);
  try {
    image = await createImageBitmap(new Blob([data.asset.body], {type: data.asset.mimeType}),
      data.variant === 'decode-none' ? {premultiplyAlpha:'default', colorSpaceConversion:'none'} : {});
    const assets = {
      image(id) { if (id !== data.asset.id) throw Error('Unexpected image'); return image; },
      descriptor(id) { if (id !== data.asset.id) throw Error('Unexpected descriptor'); return {kind:'image'}; },
      clipMask(command) {
        const mask = clipMasks.get(data.root.root.data.commands.indexOf(command));
        if (!mask || mask.width !== 1920 || mask.height !== 1080) throw Error('Missing admitted clip mask');
        return mask;
      }
    };
    canvas = new OffscreenCanvas(1920,1080);
    if (data.layered) renderMvRecipe(canvas,data.root,assets);
    else drawMvEmber(canvas.getContext('2d'),data.root.root.data,assets);
    const bitmap = canvas.transferToImageBitmap();
    postMessage({bitmap},[bitmap]);
  } catch (error) { postMessage({error:String(error)}); }
  finally { if (image) image.close(); for (const mask of clipMasks.values()) mask.close(); if (canvas) canvas.width = canvas.height = 1; }
};`;

export async function replayWorker(
	plan: MvEmberPlan,
	asset: EmberReferenceAsset,
	variant: ClipVariant,
	layered = true,
) {
	const source = clipReplaySource(variant);
	const clipMasks =
		variant === "html-coverage-mask" ? await createHtmlClipMasks(plan) : [];
	let url: string | undefined;
	let worker: Worker | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		url = URL.createObjectURL(
			new Blob([source, WORKER_ENTRY], { type: "text/javascript" }),
		);
		worker = new Worker(url);
		const activeWorker = worker;
		const bitmap = await new Promise<ImageBitmap>((resolve, reject) => {
			timer = setTimeout(
				() => reject(Error("Clip replay Worker timed out")),
				20000,
			);
			activeWorker.onerror = (event) => reject(Error(event.message));
			activeWorker.onmessage = ({ data }) => {
				if (data.bitmap instanceof ImageBitmap) resolve(data.bitmap);
				else reject(Error(data.error || "Missing Worker bitmap"));
			};
			activeWorker.postMessage(
				{ asset, variant, root: rootPlan(plan), layered, clipMasks },
				clipMasks.map(([, bitmap]) => bitmap),
			);
		});
		try {
			return clipPixels(bitmap);
		} finally {
			bitmap.close();
		}
	} finally {
		clearTimeout(timer);
		worker?.terminate();
		if (url) URL.revokeObjectURL(url);
		for (const [, bitmap] of clipMasks) bitmap.close();
	}
}
