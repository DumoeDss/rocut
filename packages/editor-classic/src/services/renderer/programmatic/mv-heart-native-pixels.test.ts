import { expect, test } from "bun:test";
import {
	readHeartNativePixels,
	type HeartNativeImageInput,
} from "./mv-heart-native-pixels";
import { source } from "./mv-heart-owner-provider-test-fixture";

function fixture() {
	const value = source();
	const input: HeartNativeImageInput = {
		resources: [{ resource: value.resource, body: value.encoded }],
		imageAdmissions: [
			{
				resource: value.resource,
				width: value.width,
				height: value.height,
				decodedBytes: value.rgba.byteLength,
			},
		],
		imageDecodeLimits: {
			maxDimension: 4096,
			maxDecodedBytes: 128 * 1024 * 1024,
		},
	};
	return { input, value };
}
/** Platform doubles prove native decoding/ownership wiring, not pixel parity. */
function platform({
	width,
	height,
	delayed = false,
}: {
	width: number;
	height: number;
	delayed?: boolean;
}) {
	const descriptors = new Map(
		["document", "createImageBitmap"].map((name) => [
			name,
			Object.getOwnPropertyDescriptor(globalThis, name),
		]),
	);
	let closed = 0,
		decodes = 0,
		reads = 0,
		draws = 0;
	const bitmap = {
		width,
		height,
		close: () => {
			closed++;
		},
	};
	let complete: () => void = () => {};
	const data = new Uint8ClampedArray(width * height * 4);
	data.fill(37);
	const canvas = {
		width: 0,
		height: 0,
		getContext: () => ({
			drawImage: (...args: unknown[]) => {
				const [image, ...position] = args;
				expect(image).toBe(bitmap);
				expect(position).toEqual([0, 0]);
				draws++;
			},
			getImageData: (...rect: unknown[]) => {
				expect(rect).toEqual([0, 0, width, height]);
				reads++;
				return { data };
			},
		}),
	};
	Object.defineProperty(globalThis, "document", {
		configurable: true,
		value: { createElement: () => canvas },
	});
	Object.defineProperty(globalThis, "createImageBitmap", {
		configurable: true,
		value: async (blob: unknown) => {
			expect(blob).toBeInstanceOf(Blob);
			decodes++;
			if (delayed)
				await new Promise<void>((resolve) => {
					complete = resolve;
				});
			return bitmap;
		},
	});
	return {
		bitmap,
		canvas,
		data,
		complete: () => complete(),
		counts: () => ({ closed, decodes, reads, draws }),
		restore() {
			for (const [name, descriptor] of descriptors) {
				if (descriptor) Object.defineProperty(globalThis, name, descriptor);
				else Reflect.deleteProperty(globalThis, name);
			}
		},
	};
}
test("native Heart resource readback keeps admitted bytes and actual RGBA views, then releases decoder/backing", async () => {
	const { input, value } = fixture(),
		host = platform(value);
	try {
		const result = await readHeartNativePixels({
			input,
			resource: value.resource,
		});
		expect(result.encoded).toBe(value.encoded);
		expect(result.rgba.buffer).toBe(host.data.buffer);
		expect([...result.rgba]).toEqual([...host.data]);
		expect([result.width, result.height]).toEqual([value.width, value.height]);
		expect(host.counts()).toEqual({
			closed: 1,
			decodes: 1,
			reads: 1,
			draws: 1,
		});
		expect([host.canvas.width, host.canvas.height]).toEqual([1, 1]);
	} finally {
		host.restore();
	}
});
test("missing/duplicate/substituted admission and over-limit sizes fail before native decode", async () => {
	const { input, value } = fixture(),
		host = platform(value);
	try {
		const admission = input.imageAdmissions[0]!;
		for (const imageAdmissions of [
			[],
			[admission, admission],
			[{ ...admission, decodedBytes: 1 }],
			[
				{
					...admission,
					resource: { ...value.resource, sha256: "a".repeat(64) },
				},
			],
		])
			await expect(
				readHeartNativePixels({
					input: { ...input, imageAdmissions },
					resource: value.resource,
				}),
			).rejects.toThrow();
		await expect(
			readHeartNativePixels({
				input: {
					...input,
					imageDecodeLimits: { maxDimension: 4096, maxDecodedBytes: 1 },
				},
				resource: value.resource,
			}),
		).rejects.toThrow();
		expect(host.counts().decodes).toBe(0);
	} finally {
		host.restore();
	}
});
test("actual decoded dimension substitution releases the bitmap before any Canvas allocation", async () => {
	const { input, value } = fixture(),
		host = platform({ width: value.width + 1, height: value.height });
	try {
		await expect(
			readHeartNativePixels({ input, resource: value.resource }),
		).rejects.toThrow("actual decoded dimensions");
		expect(host.counts()).toEqual({
			closed: 1,
			decodes: 1,
			reads: 0,
			draws: 0,
		});
		expect(host.canvas.width).toBe(0);
	} finally {
		host.restore();
	}
});
test("late native decode after abort closes the bitmap without reading or allocating scratch", async () => {
	const { input, value } = fixture(),
		host = platform({ ...value, delayed: true }),
		controller = new AbortController();
	try {
		const pending = readHeartNativePixels({
			input,
			resource: value.resource,
			signal: controller.signal,
		});
		controller.abort(Error("cancel-heart-native-decode"));
		host.complete();
		await expect(pending).rejects.toThrow("cancel-heart-native-decode");
		expect(host.counts()).toEqual({
			closed: 1,
			decodes: 1,
			reads: 0,
			draws: 0,
		});
		expect(host.canvas.width).toBe(0);
	} finally {
		host.restore();
	}
});
