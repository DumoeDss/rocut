import { expect } from "bun:test";
import type {
	MvEmberCommand,
	MvEmberSurfaceDraw,
} from "@opencut/editor-contracts";
import { emberRasterFixture } from "./mv-ember-recording-fixture";

export const grayPixels = {
	kind: "grayPixels",
	size: [2, 2],
	gray: [0, 7, 128, 255],
	position: [-3, 5],
} as const satisfies MvEmberSurfaceDraw;

export function blit(surface: string): MvEmberCommand & { kind: "blit" } {
	return {
		kind: "blit",
		surface,
		transform: [1, 0, 0, 1, 0, 0],
		sourceRect: [0, 0, 8, 9],
		destinationRect: [10, 20, 8, 9],
		composite: "source-over",
		opacity: 0.7,
	};
}

export function surface(id: string): MvEmberCommand & { kind: "surface" } {
	return { kind: "surface", id, size: [8, 9], commands: [grayPixels] };
}

export function extendedFixture() {
	const io = emberRasterFixture();
	Object.assign(io.output.ctx, {
		filter: "blur(2px)",
		globalAlpha: 0.37,
		globalCompositeOperation: "xor",
		letterSpacing: "9px",
	});
	return { io, initial: io.output.ctx.properties() };
}

export function expectReleased({
	io,
	initial,
}: ReturnType<typeof extendedFixture>) {
	expect(io.output.ctx.properties()).toEqual(initial);
	expect(io.output.ctx.stack).toHaveLength(0);
	expect(io.output.ctx.state.transform).toEqual([]);
	expect(io.output.ctx.state.clip).toEqual([]);
	expect([io.output.width, io.output.height]).toEqual([1920, 1080]);
	for (const canvas of io.canvases.slice(1)) {
		expect([canvas.width, canvas.height]).toEqual([1, 1]);
		expect(canvas.ctx.stack).toHaveLength(0);
	}
	expect(io.closes()).toBe(0);
	expect(io.assets.image("image")).toBe(io.picture);
	expect(io.assets.descriptor("font").kind).toBe("font");
}

export function drain(
	steps: ReturnType<ReturnType<typeof emberRasterFixture>["steps"]>,
) {
	let count = 0;
	while (!steps.next().done) count++;
	return count;
}
