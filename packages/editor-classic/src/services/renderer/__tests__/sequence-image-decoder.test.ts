import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import type {
	SequenceImage,
	ResolvedSequenceImage,
} from "@opencut/editor-contracts";
import { SEQUENCE_IMAGE_DECODER_SOURCE } from "../programmatic/sequence-image-decoder";

function selection(index: number) {
	const resource = {
		id: `${index}.png`,
		kind: "image" as const,
		mimeType: "image/png",
		byteLength: 1,
		sha256: String(index).repeat(64),
		attachmentKey: `programmatic-sha256-${String(index).repeat(64)}`,
	};
	const planned: SequenceImage = {
		imageKey: `selected-${index}`,
		manifestId: "shot.json",
		manifestSha256: "a".repeat(64),
		ordinal: index,
		resource,
		width: 2,
		height: 1,
		alpha: "straight",
	};
	const resolved: ResolvedSequenceImage = {
		imageKey: planned.imageKey,
		resource,
		body: new ArrayBuffer(1),
	};
	return { planned, resolved };
}

/** Runs the exact Worker decoder with controlled physical decode IO. */
function decoder(
	dimensions: readonly (readonly [number, number] | Error)[] = [
		[2, 1],
		[2, 1],
	],
) {
	const bitmaps: {
		width: number;
		height: number;
		closes: number;
		close(): void;
	}[] = [];
	let calls = 0;
	const decode: (
		frame: object,
		inputs: readonly ResolvedSequenceImage[],
	) => Promise<{
		images: Map<string, object>;
		close(): void;
	}> = runInNewContext(
		`${SEQUENCE_IMAGE_DECODER_SOURCE}; decodeMvSequenceImages`,
		{
			ArrayBuffer,
			Blob,
			createImageBitmap: async () => {
				const shape = dimensions[calls++];
				if (shape instanceof Error) throw shape;
				const bitmap = {
					width: shape[0],
					height: shape[1],
					closes: 0,
					close() {
						this.closes++;
					},
				};
				bitmaps.push(bitmap);
				return bitmap;
			},
		},
	);
	return { decode, bitmaps, calls: () => calls };
}

const limits = { maxDimension: 8192, maxDecodedBytes: 128 * 1024 * 1024 };

test("distinct selections of identical bytes decode and close exactly once", async () => {
	const a = selection(1),
		original = selection(2);
	const b = {
		planned: { ...original.planned, resource: a.planned.resource },
		resolved: { ...original.resolved, resource: a.resolved.resource },
	};
	const io = decoder();
	const output = await io.decode(
		{ sequenceImages: [a.planned, b.planned], sequenceLimits: limits },
		[a.resolved, b.resolved],
	);
	expect(io.calls()).toBe(1);
	expect(output.images.size).toBe(2);
	expect(output.images.get("selected-1")).toBe(output.images.get("selected-2"));
	output.close();
	output.close();
	expect(io.bitmaps[0].closes).toBe(1);
});

test("every manifest/transport mismatch is rejected before any bitmap allocation", async () => {
	const a = selection(1),
		b = selection(2);
	const frame = { sequenceImages: [a.planned], sequenceLimits: limits };
	for (const [plan, inputs] of [
		[frame, []],
		[frame, [a.resolved, b.resolved]],
		[frame, [b.resolved]],
		[frame, [{ ...a.resolved, body: new ArrayBuffer(2) }]],
		[
			frame,
			[
				{
					...a.resolved,
					resource: { ...a.resolved.resource, id: "other.png" },
				},
			],
		],
		[{ sequenceImages: [a.planned] }, [a.resolved]],
		[
			{ ...frame, sequenceLimits: { ...limits, maxDecodedBytes: 4 } },
			[a.resolved],
		],
		[
			{ ...frame, sequenceImages: [a.planned, a.planned] },
			[a.resolved, a.resolved],
		],
	] as const) {
		const io = decoder();
		await expect(io.decode(plan, inputs)).rejects.toThrow();
		expect(io.calls()).toBe(0);
	}
});

test("decode size mismatch and later decode failures release every allocated bitmap", async () => {
	const a = selection(1),
		b = selection(2);
	for (const shapes of [[[3, 1]], [[2, 1], Error("invalid PNG")]] as const) {
		const io = decoder(shapes);
		await expect(
			io.decode(
				{ sequenceImages: [a.planned, b.planned], sequenceLimits: limits },
				[a.resolved, b.resolved],
			),
		).rejects.toThrow();
		expect(io.bitmaps.length).toBe(1);
		expect(io.bitmaps[0].closes).toBe(1);
	}
});

test("conflicting dimensions for shared bytes fail before decode", async () => {
	const a = selection(1);
	const b = { ...a.planned, imageKey: "second-instance", width: 4 };
	const io = decoder();
	await expect(
		io.decode({ sequenceImages: [a.planned, b], sequenceLimits: limits }, [
			a.resolved,
			{ ...a.resolved, imageKey: b.imageKey },
		]),
	).rejects.toThrow("geometry");
	expect(io.calls()).toBe(0);
});
