import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { IMAGE_PREPROCESS_RENDERER_SOURCE } from "./image-preprocess-renderer";

function fixture() {
	const binding = {
		resource: {
			id: "image",
			kind: "image",
			attachmentKey: "test.png",
			mimeType: "image/png",
			byteLength: 4,
			sha256: "a".repeat(64),
		},
		width: 2,
		height: 2,
		flameAt: [1, 1, 1, 1, 1, 1],
		algorithm: "flame-deflame-v1",
	};
	const request = { binding, roi: { x: 1, y: 1, width: 1, height: 1 } };
	const header = new TextEncoder().encode(JSON.stringify(request)),
		envelope = new Uint8Array(4 + header.byteLength + 4);
	new DataView(envelope.buffer).setUint32(0, header.byteLength, true);
	envelope.set(header, 4);
	envelope.set([17, 23, 31, 255], 4 + header.byteLength);
	const patch = { patchKey: "opaque", envelope },
		command = { kind: "preparedPatch", patchKey: "opaque", request };
	return { patch, command };
}
function renderer() {
	const result: unknown = runInNewContext(
		IMAGE_PREPROCESS_RENDERER_SOURCE + ";createMvPreparedPatches",
		{
			Uint8Array,
			Uint8ClampedArray,
			DataView,
			TextDecoder,
			ImageData: class {
				readonly data: Uint8ClampedArray;
				readonly width: number;
				readonly height: number;
				constructor(...args: [Uint8ClampedArray, number, number]) {
					[this.data, this.width, this.height] = args;
				}
			},
			sameMvImageIdentity: (a: unknown, b: unknown) =>
				JSON.stringify(a) === JSON.stringify(b),
		},
	);
	if (typeof result !== "function") throw Error("Missing fixed patch renderer");
	return result;
}
test("binary patch restores exact RGBA at Rust ROI under identity transform", () => {
	const { patch, command } = fixture(),
		calls: unknown[] = [];
	const apply: unknown = renderer()([patch]);
	if (typeof apply !== "function") throw Error("Missing patch lookup");
	apply(command, {
		canvas: { width: 2, height: 2 },
		setTransform: (...args: number[]) => calls.push(args),
		putImageData: (image: { data: Uint8ClampedArray }, x: number, y: number) =>
			calls.push([[...image.data], x, y]),
	});
	expect(calls).toEqual([
		[1, 0, 0, 1, 0, 0],
		[[17, 23, 31, 255], 1, 1],
	]);
});
test("full resource or ROI substitution is rejected before drawing", () => {
	const { patch, command } = fixture(),
		apply: unknown = renderer()([patch]);
	if (typeof apply !== "function") throw Error("Missing patch lookup");
	const target = { canvas: { width: 2, height: 2 } };
	command.request.binding.resource.sha256 = "b".repeat(64);
	expect(() => apply(command, target)).toThrow("identity/ROI");
	const other = fixture();
	other.command.request.roi.x = 0;
	expect(() => apply(other.command, target)).toThrow("identity/ROI");
});
test("reordered binary metadata is accepted but unknown metadata is rejected", () => {
	const { patch, command } = fixture();
	Reflect.set(command.request.binding, "resource", Object.fromEntries(Object.entries(command.request.binding.resource).reverse()));
	const apply: unknown = renderer()([patch]);
	if (typeof apply !== "function") throw Error("Missing patch lookup");
	let drawn = 0;
	const target = { canvas: { width: 2, height: 2 }, setTransform() {}, putImageData() { drawn++; } };
	apply(command, target);
	expect(drawn).toBe(1);
	Reflect.set(command.request.binding.resource, "unknown", true);
	expect(() => apply(command, target)).toThrow("identity/ROI");
});
test("wrong target size, duplicate keys and truncated binary are rejected", () => {
	const { patch, command } = fixture(),
		factory = renderer(),
		apply: unknown = factory([patch]);
	if (typeof apply !== "function") throw Error("Missing patch lookup");
	expect(() => apply(command, { canvas: { width: 3, height: 2 } })).toThrow(
		"dimensions",
	);
	expect(() => factory([patch, patch])).toThrow("binary");
	expect(() =>
		factory([
			{
				...patch,
				envelope: patch.envelope.subarray(0, patch.envelope.length - 1),
			},
		]),
	).toThrow("binding/ROI");
});
