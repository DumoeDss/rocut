import { runInNewContext } from "node:vm";
import { MV_HEART_RENDERER_SOURCE } from "./mv-heart-renderer";
import {
	createEmberRecordingContext,
	type EmberRasterEvent,
} from "./__tests__/mv-ember-recording-context";

/** Operation recorder, not native pixels or a browser parity oracle. */
export function heartRendererFixture({
	reuseReleasedIds = false,
}: { reuseReleasedIds?: boolean } = {}) {
	const events: EmberRasterEvent[] = [],
		canvases: Canvas[] = [];
	const Context = createEmberRecordingContext({ events });
	class Canvas {
		ctx: InstanceType<typeof Context>;
		constructor(...[width, height]: [number, number]) {
			this.width = width;
			this.height = height;
			this.ctx = new Context(`canvas${canvases.length}`);
			canvases.push(this);
		}
		width: number;
		height: number;
		getContext() {
			return this.ctx;
		}
	}
	let closes = 0;
	const bitmap = {
		width: 300,
		height: 600,
		close() {
			closes++;
		},
	};
	const requested: unknown[] = [];
	const assets = {
		preparedImage(image: unknown) {
			requested.push(image);
			return bitmap;
		},
		image() {
			throw Error("No ordinary image fallback");
		},
		descriptor() {
			throw Error("No ordinary resource fallback");
		},
	};
	const api: {
		draw(
			ctx: InstanceType<typeof Context>,
			plan: unknown,
			resources: typeof assets,
			createSurface: undefined,
			reuseReleasedIds: boolean,
		): void;
		steps(
			ctx: InstanceType<typeof Context>,
			plan: unknown,
			resources: typeof assets,
			createSurface: undefined,
			reuseReleasedIds: boolean,
		): Generator<void, void, unknown>;
	} = runInNewContext(
		`${MV_HEART_RENDERER_SOURCE};({draw:drawMvHeart,steps:drawMvHeartSteps})`,
		{ OffscreenCanvas: Canvas },
	);
	const output = new Canvas(1920, 1080);
	return {
		events,
		canvases,
		output,
		assets,
		bitmap,
		requested,
		closes: () => closes,
		draw: (plan: unknown) =>
			api.draw(output.ctx, plan, assets, undefined, reuseReleasedIds),
		steps: (plan: unknown) =>
			api.steps(output.ctx, plan, assets, undefined, reuseReleasedIds),
	};
}
