import { runInNewContext } from "node:vm";
import { MV_RECIPE_RENDERER_SOURCE } from "../mv-recipe-renderer";
import {
	createEmberRecordingContext,
	type EmberRasterEvent,
} from "./mv-ember-recording-context";
import { PRE_ITERATOR_RECIPE_SOURCE } from "./mv-recipe-original-replay";

export function recipeRecordingFixture(
	options: {
		drawErrorAt?: number;
		failFactoryAt?: number;
		noContextAt?: number;
	} = {},
) {
	const events: EmberRasterEvent[] = [];
	const canvases: Canvas[] = [];
	const lifecycle: unknown[] = [];
	const BaseContext = createEmberRecordingContext({ events });
	let draws = 0,
		factoryCalls = 0,
		closes = 0;
	class Context extends BaseContext {
		canvas?: Canvas;
		pixels?: Uint8ClampedArray;
		globalAlpha = 1;
		globalCompositeOperation = "source-over";
		rect(...args: number[]) {
			this.path({ op: "rect", args });
		}
		strokeRect(...args: number[]) {
			this.record({ op: "strokeRect", args });
		}
		drawImage(...args: unknown[]) {
			super.drawImage(...args);
			if (++draws === options.drawErrorAt) throw Error("recipe draw failure");
		}
		measureText() {
			return {
				actualBoundingBoxLeft: 3,
				actualBoundingBoxRight: 7,
				actualBoundingBoxAscent: 8,
				actualBoundingBoxDescent: 2,
			};
		}
		getImageData(...args: number[]) {
			this.record({ op: "getImageData", args });
			const data =
				this.pixels?.slice() ??
				new Uint8ClampedArray(
					this.canvas!.width * this.canvas!.height * 4,
				).fill(64);
			return { data };
		}
		putImageData(...args: [{ data: Uint8ClampedArray }, number, number]) {
			super.putImageData(...args);
			this.pixels = args[0].data.slice();
		}
	}
	class Canvas {
		private w: number;
		private h: number;
		readonly initial: readonly [number, number];
		readonly ctx: Context;
		readonly id: number;
		readonly backend: string;
		constructor(
			...[width, height, backend = "offscreen"]: [number, number, string?]
		) {
			this.backend = backend;
			this.w = width;
			this.h = height;
			this.initial = [width, height];
			this.id = canvases.length;
			this.ctx = new Context(`canvas${this.id}`);
			this.ctx.canvas = this;
			canvases.push(this);
			lifecycle.push(["allocate", this.id, width, height]);
		}
		get width() {
			return this.w;
		}
		set width(value: number) {
			this.w = value;
			lifecycle.push(["width", this.id, value]);
		}
		get height() {
			return this.h;
		}
		set height(value: number) {
			this.h = value;
			lifecycle.push(["height", this.id, value]);
		}
		getContext(kind: string) {
			lifecycle.push(["context", this.id, kind]);
			if (kind !== "2d") {
				if (this.backend !== "offscreen")
					throw Error("WebGL incorrectly used native 2D factory");
				return null;
			}
			return this.id === options.noContextAt ? null : this.ctx;
		}
	}
	const createSurface = (...[width, height]: [number, number]) => {
		if (++factoryCalls === options.failFactoryAt)
			throw Error("factory allocation failure");
		return new Canvas(width, height, "native2d");
	};
	const image = {
		width: 4,
		height: 8,
		tag: "declared image",
		close() {
			closes++;
		},
	};
	const assets = {
		descriptor(id: string) {
			if (id === "font")
				return {
					kind: "font",
					font: { family: "Declared Font", style: "normal", weight: 400 },
				};
			if (id === "image") return { kind: "image" };
			throw Error("Missing declared resource");
		},
		image(id: string) {
			if (id !== "image") throw Error("Missing declared image");
			return image;
		},
		sequenceImage() {
			return image;
		},
	};
	type Factory = typeof createSurface;
	type Steps = Generator<void, void, unknown>;
	interface Api {
		render(c: Canvas, p: unknown, a: typeof assets, f?: Factory): void;
		steps(c: Canvas, p: unknown, a: typeof assets, f?: Factory): Steps;
		post(c: Canvas, e: unknown): void;
		postSteps(c: Canvas, e: unknown): Steps;
	}
	const api: Api = runInNewContext(
		`${MV_RECIPE_RENDERER_SOURCE};({render:renderMvRecipe,steps:renderMvRecipeSteps,post:applyMvPost,postSteps:applyMvPostSteps})`,
		{ OffscreenCanvas: Canvas },
	);
	const original: Api["render"] = runInNewContext(
		`${MV_RECIPE_RENDERER_SOURCE}\n${PRE_ITERATOR_RECIPE_SOURCE};renderMvRecipe`,
		{ OffscreenCanvas: Canvas },
	);
	const output = new Canvas(4, 3, "caller");
	const trace = () =>
		JSON.stringify({ events, lifecycle }, (_key, value) =>
			value instanceof Canvas
				? { canvas: value.id, initial: value.initial }
				: value,
		);
	return {
		events,
		canvases,
		lifecycle,
		output,
		assets,
		createSurface,
		trace,
		closes: () => closes,
		original: (plan: unknown) => original(output, plan, assets),
		render: ({ plan, native = false }: { plan: unknown; native?: boolean }) =>
			api.render(output, plan, assets, native ? createSurface : undefined),
		steps: ({ plan, native = false }: { plan: unknown; native?: boolean }) =>
			api.steps(output, plan, assets, native ? createSurface : undefined),
		post: (effects: unknown) => api.post(output, effects),
		postSteps: (effects: unknown) => api.postSteps(output, effects),
	};
}
