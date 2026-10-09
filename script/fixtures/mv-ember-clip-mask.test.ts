import { expect, test } from "bun:test";
import { clipReplaySource } from "./mv-ember-clip-replay";
import {
	createEmberRecordingContext,
	type EmberRasterEvent,
} from "../../packages/editor-classic/src/services/renderer/programmatic/__tests__/mv-ember-recording-context";

test("image masking never destination-in masks the destination and clears each reused slice", () => {
	const events: EmberRasterEvent[] = [],
		canvases: Canvas[] = [];
	const Context = createEmberRecordingContext({ events });
	class Canvas {
		readonly ctx: InstanceType<typeof Context>;
		constructor(
			public width: number,
			public height: number,
		) {
			this.ctx = new Context(`canvas${canvases.length}`);
			this.ctx.canvas = this;
			canvases.push(this);
		}
		getContext() {
			return this.ctx;
		}
	}
	const output = new Canvas(100, 100);
	const draw = new Function(
		"OffscreenCanvas",
		`${clipReplaySource("image-mask")}\nreturn drawMvEmber;`,
	)(Canvas);
	const identity = [1, 0, 0, 1, 0, 0];
	const clip = {
		transform: identity,
		path: [
			{ kind: "arc", center: [50, 50], radius: 20, start: 0, end: Math.PI * 2 },
			{
				kind: "arc",
				center: [50, 50],
				radius: 10,
				start: 0,
				end: Math.PI * 2,
				anticlockwise: true,
			},
		],
	};
	const command = {
		kind: "image",
		image: "test",
		transform: identity,
		clip,
		destinationRect: [0, 0, 100, 100],
		smoothing: true,
		smoothingQuality: "high",
		composite: "source-over",
	};
	draw(
		output.ctx,
		{
			commands: [
				{ ...command, opacity: 0.5 },
				{ ...command, opacity: 0.8 },
			],
		},
		{
			descriptor: () => ({ kind: "image" }),
			image: () => ({ width: 100, height: 100 }),
		},
	);
	const targetEvents = events.filter((event) => event.target === "canvas0");
	const scratchEvents = events.filter((event) => event.target === "canvas1");
	expect(canvases).toHaveLength(2);
	expect(
		targetEvents.some(
			(event) => event.state.globalCompositeOperation === "destination-in",
		),
	).toBe(false);
	expect(
		targetEvents.filter(
			(event) => event.op === "clearRect" || event.op === "clip",
		),
	).toHaveLength(0);
	expect(
		targetEvents
			.filter((event) => event.op === "drawImage")
			.map((event) => event.state.globalAlpha),
	).toEqual([0.5, 0.8]);
	expect(
		scratchEvents.filter((event) => event.op === "clearRect"),
	).toHaveLength(2);
	const fills = scratchEvents.filter((event) => event.op === "fill");
	expect(fills).toHaveLength(2);
	for (const fill of fills) {
		expect(fill.state.globalCompositeOperation).toBe("destination-in");
		expect(fill.state.globalAlpha).toBe(1);
		expect(fill.state.steps).toEqual([
			["arc", 50, 50, 20, 0, Math.PI * 2, false],
			["arc", 50, 50, 10, 0, Math.PI * 2, true],
		]);
	}
	expect(canvases[1].width).toBe(1);
	expect(canvases[1].height).toBe(1);
	expect(output.ctx.stack).toHaveLength(0);
	expect(canvases[1].ctx.stack).toHaveLength(0);
});
