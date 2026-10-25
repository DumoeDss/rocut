import { BaseNode } from "./base-node";
import type { TextElement } from "../../../timeline";
import type { EffectPass } from "../../../effects/types";
import type { BlendMode, Transform } from "../../../rendering";
import { drawMeasuredTextLayout } from "../../../text/primitives";
import type { MeasuredTextElement } from "../../../text/measure-element";
import type { MotionTextFontRuntime } from "../motion-text/font-runtime";
import { pinnedTextFont } from "./text-font-resource";

export type TextNodeParams = TextElement & {
	transform: Transform;
	opacity: number;
	blendMode?: BlendMode;
	canvasCenter: { x: number; y: number };
	canvasHeight: number;
	textBaseline?: CanvasTextBaseline;
	fontRuntime?: MotionTextFontRuntime;
	projectId?: string;
};

export interface ResolvedTextNodeState {
	transform: Transform;
	opacity: number;
	textColor: string;
	backgroundColor: string;
	effectPasses: EffectPass[][];
	measuredText: MeasuredTextElement;
}

export class TextNode extends BaseNode<TextNodeParams, ResolvedTextNodeState> {
	private prepared:
		| {
				generation: number;
				text: string;
				source: string;
				pending: Promise<string>;
		  }
		| undefined;

	async measurementParams(signal?: AbortSignal): Promise<TextNodeParams> {
		const font = pinnedTextFont(
			this.params.params["mv.fontResource"],
			undefined,
			this.params.params.fontFamily as string,
		);
		if (!font) return this.params;
		const { fontRuntime, projectId } = this.params;
		if (!fontRuntime || !projectId)
			throw Error("Pinned text font runtime is unavailable");
		signal?.throwIfAborted();
		const generation = fontRuntime.inspect().generation;
		const text = String(this.params.params.content ?? "");
		const source = String(this.params.params["mv.fontResource"]);
		if (
			!this.prepared ||
			this.prepared.generation !== generation ||
			this.prepared.text !== text ||
			this.prepared.source !== source
		)
			this.prepared = {
				generation,
				text,
				source,
				pending: fontRuntime
					.prepareFont({ projectId, font, text })
					.then((value) => value.family),
			};
		const family = await this.prepared.pending;
		signal?.throwIfAborted();
		if (generation !== fontRuntime.inspect().generation)
			throw Error("Text font preparation became stale");
		return {
			...this.params,
			params: { ...this.params.params, fontFamily: family },
		};
	}
}

export function renderTextToContext({
	node,
	ctx,
}: {
	node: TextNode;
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
}): void {
	const resolved = node.resolved;
	if (!resolved) {
		return;
	}

	const x = resolved.transform.position.x + node.params.canvasCenter.x;
	const y = resolved.transform.position.y + node.params.canvasCenter.y;
	const baseline = node.params.textBaseline ?? "middle";

	ctx.save();
	ctx.translate(x, y);
	ctx.scale(resolved.transform.scaleX, resolved.transform.scaleY);
	if (resolved.transform.rotate) {
		ctx.rotate((resolved.transform.rotate * Math.PI) / 180);
	}

	drawMeasuredTextLayout({
		ctx,
		layout: resolved.measuredText,
		textColor: resolved.textColor,
		background: resolved.measuredText.resolvedBackground,
		backgroundColor: resolved.backgroundColor,
		textBaseline: baseline,
	});

	ctx.restore();
}
