import type { MvEmberPlan } from "../../packages/editor-contracts/src/mv-ember-plan";
import { MV_EMBER_RASTER_SOURCE } from "../../packages/editor-classic/src/services/renderer/programmatic/mv-ember-raster";
import { check } from "./mv-ember-clip-input";

/** Trusted diagnostic primitives only: no source.code, image/font decode or
 * authored JavaScript is passed to this realm. Production would require its
 * own canonical native request + allocation admission, not this test helper. */
export async function createHtmlClipMasks(plan: MvEmberPlan) {
	const masks: (readonly [number, ImageBitmap])[] = [];
	const api = new Function(
		`${MV_EMBER_RASTER_SOURCE}; return {transform:mvEmberTransform,path:mvEmberPath};`,
	)();
	const clipped = plan.commands.flatMap((command, index) =>
		(command.kind === "image" || command.kind === "rect") && command.clip
			? [{ command, index }]
			: [],
	);
	check(
		clipped.length <= 16 && clipped.length * 1920 * 1080 <= 32_000_000,
		"Diagnostic clip mask allocation limit exceeded",
	);
	try {
		for (const { command, index } of clipped) {
			check(
				command.clip && command.clip.path.length <= 128,
				"Diagnostic requires bounded native clip paths",
			);
			const canvas = document.createElement("canvas");
			canvas.width = 1920;
			canvas.height = 1080;
			try {
				const ctx = canvas.getContext("2d")!;
				api.transform(ctx, command.clip);
				api.path(ctx, command.clip.path);
				ctx.clip("nonzero");
				ctx.setTransform(1, 0, 0, 1, 0, 0);
				ctx.fillStyle = "white";
				ctx.fillRect(0, 0, 1920, 1080);
				masks.push([index, await createImageBitmap(canvas)]);
			} finally {
				canvas.width = canvas.height = 1;
			}
		}
		return masks;
	} catch (error) {
		for (const [, bitmap] of masks) bitmap.close();
		throw error;
	}
}
