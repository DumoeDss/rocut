import { runInNewContext } from "node:vm";
import { MV_EMBER_RENDERER_SOURCE } from "../mv-ember-renderer";
import { MV_EMBER_RASTER_SOURCE } from "../mv-ember-raster";
import { MV_RECIPE_RENDERER_SOURCE } from "../mv-recipe-renderer";

import {
	createEmberRecordingContext,
	type EmberRasterEvent,
} from "./mv-ember-recording-context";

// Frozen pre-iterator replay control flow. Comparing the new wrapper only to
// its own iterator would not detect reordered or omitted Canvas operations.
const PRE_ITERATOR_REPLAY = String.raw`
function drawMvEmber(ctx, data, assets) {
  const allocated = [], scratch = new Map();
  const make = size => {
    const canvas = new OffscreenCanvas(...size); allocated.push(canvas); return canvas;
  };
  const initialize = target => {
    target.filter = 'none'; target.shadowColor = 'rgba(0,0,0,0)';
    target.setLineDash([]); target.lineDashOffset = 0; target.miterLimit = 10;
    target.imageSmoothingEnabled = true; target.imageSmoothingQuality = 'low';
  };
  const draw = (target, command) => {
    target.save();
    try {
      if (command.clip) {
        mvEmberTransform(target,command.clip);
        mvEmberPath(target,command.clip.path); target.clip('nonzero');
      }
      mvEmberTransform(target,command);
      if (command.kind === 'path') {
        mvEmberPath(target,command.path);
        for (const spec of command.paints) mvEmberPaint(target,spec);
      } else if (command.kind === 'rect') mvEmberPaint(target,command.paint,command.rect);
      else if (command.kind === 'grain') mvEmberGrain(target,command,make);
      else if (command.kind === 'text') mvEmberText(target,command,assets);
      else if (command.kind === 'image') {
        if (assets.descriptor(command.image).kind !== 'image') throw Error('Ember image requires a declared image');
        target.globalCompositeOperation = command.composite; target.globalAlpha = command.opacity;
        target.imageSmoothingEnabled = command.smoothing; target.imageSmoothingQuality = command.smoothingQuality;
        target.drawImage(assets.image(command.image),...command.destinationRect);
      } else if (command.kind === 'blit') {
        const source = scratch.get(command.surface);
        if (!source) throw Error('Ember blit requires an earlier scratch surface');
        target.globalCompositeOperation = command.composite; target.globalAlpha = command.opacity;
        target.drawImage(source,...command.sourceRect,...command.destinationRect);
      } else throw Error('Unsupported Ember draw command');
    } finally { target.restore(); }
  };
  ctx.save();
  try {
    initialize(ctx);
    for (const command of data.commands) {
      if (command.kind !== 'surface') { draw(ctx,command); continue; }
      if (scratch.has(command.id)) throw Error('Duplicate Ember scratch surface');
      const surface = make(command.size), target = surface.getContext('2d');
      if (!target) throw Error('Ember scratch surface requires Canvas2D');
      initialize(target);
      // Flat DAG: only earlier, fully drawn surfaces are available for sampling.
      for (const child of command.commands) {
        if (child.kind === 'surface') throw Error('Nested Ember scratch operations are not supported');
        draw(target,child);
      }
      scratch.set(command.id,surface);
    }
  } finally {
    ctx.restore();
    for (const surface of allocated) { surface.width = 1; surface.height = 1; }
    scratch.clear();
  }
}
`;

export function emberRasterFixture(
	options: {
		noContext?: number;
		noPattern?: boolean;
		drawError?: boolean;
	} = {},
) {
	const events: EmberRasterEvent[] = [],
		canvases: Canvas[] = [];
	const Context = createEmberRecordingContext({ events, ...options });
	type Context = InstanceType<typeof Context>;
	class Canvas {
		width: number;
		height: number;
		readonly initial: readonly [number, number];
		readonly ctx: Context;
		constructor(...[w, h]: [number, number]) {
			this.width = w;
			this.height = h;
			this.initial = [w, h];
			this.ctx = new Context(`canvas${canvases.length}`);
			canvases.push(this);
		}
		getContext() {
			return canvases.indexOf(this) === options.noContext ? null : this.ctx;
		}
	}
	let closes = 0;
	const picture = {
		tag: "decoded-picture",
		width: 300,
		height: 600,
		close() {
			closes++;
		},
	};
	const assets = {
		descriptor(id: string) {
			if (id === "image") return { kind: "image" };
			if (id === "font")
				return {
					kind: "font",
					font: {
						family: "Declared Font",
						style: "italic",
						weight: 500,
						axes: { TEST: 550 },
					},
				};
			throw Error("Unknown resource");
		},
		image(id: string) {
			if (id !== "image") throw Error("Missing declared image");
			return picture;
		},
	};
	const noFormula = Object.create(Math);
	for (const name of ["sin", "cos", "random", "floor", "round", "pow"])
		noFormula[name] = () => {
			throw Error(`Raster used ${name}`);
		};
	const api: {
		draw(ctx: Context, plan: unknown, resources: typeof assets): void;
		steps(
			ctx: Context,
			plan: unknown,
			resources: typeof assets,
		): Generator<void, void, unknown>;
		render(canvas: Canvas, plan: unknown, resources: typeof assets): void;
	} = runInNewContext(
		`${MV_RECIPE_RENDERER_SOURCE}\n;({draw:drawMvEmber,steps:drawMvEmberSteps,render:renderMvRecipe})`,
		{ OffscreenCanvas: Canvas, Math: noFormula },
	);
	const originalDraw: typeof api.draw = runInNewContext(
		`${MV_EMBER_RASTER_SOURCE}\n${PRE_ITERATOR_REPLAY};drawMvEmber`,
		{ OffscreenCanvas: Canvas, Math: noFormula },
	);
	// The standalone source must also contain every helper, with no hidden imports.
	runInNewContext(`${MV_EMBER_RENDERER_SOURCE}; drawMvEmber`, {
		OffscreenCanvas: Canvas,
	});
	const output = new Canvas(1920, 1080);
	return {
		events,
		canvases,
		output,
		assets,
		picture,
		closes: () => closes,
		draw: (plan: unknown) => api.draw(output.ctx, plan, assets),
		steps: (plan: unknown) => api.steps(output.ctx, plan, assets),
		originalDraw: (plan: unknown) => originalDraw(output.ctx, plan, assets),
		trace: () =>
			JSON.stringify(events, (_key, value) =>
				value instanceof Canvas
					? { canvas: canvases.indexOf(value), initial: value.initial }
					: value,
			),
		render: (plan: unknown) => api.render(output, plan, assets),
	};
}
