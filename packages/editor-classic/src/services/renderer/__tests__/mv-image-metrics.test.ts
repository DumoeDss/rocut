import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { IMAGE_DIMENSIONS_WORKER_SOURCE } from "../programmatic/image-dimensions-worker";
import { SEQUENCE_IMAGE_DECODER_SOURCE } from "../programmatic/sequence-image-decoder";

const limits = { maxDimension: 8192, maxDecodedBytes: 128 * 1024 * 1024 };
function image(id = "cover.png") {
	const resource = {
		id,
		kind: "image",
		mimeType: "image/png",
		byteLength: 1,
		sha256: "a".repeat(64),
		attachmentKey: `programmatic-sha256-${"a".repeat(64)}`,
	};
	return { resource, body: new ArrayBuffer(1) };
}
function admission(item = image(), width = 3, height = 2) {
	return {
		resource: item.resource,
		width,
		height,
		decodedBytes: width * height * 4,
	};
}
function worker(shapes: ([number, number] | Error)[] = [[3, 2]]) {
	const bitmaps: {
		width: number;
		height: number;
		closes: number;
		close(): void;
	}[] = [];
	let calls = 0;
	const api = runInNewContext(
		`${IMAGE_DIMENSIONS_WORKER_SOURCE}\n${SEQUENCE_IMAGE_DECODER_SOURCE}
		;({budget:createMvImageDecodeBudget,images:decodeMvDeclaredImages,sequences:decodeMvSequenceImages})`,
		{
			ArrayBuffer,
			Blob,
			createImageBitmap: async () => {
				const next = shapes[calls++];
				if (next instanceof Error) throw next;
				const bitmap = {
					width: next[0],
					height: next[1],
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
	return { ...api, bitmaps, calls: () => calls };
}

test("image facts come from decoded dimensions, including EXIF axis swaps", async () => {
	const item = image();
	for (const shape of [
		[3, 2],
		[2, 3],
	] as [number, number][]) {
		const io = worker([shape]);
		const result = await io.images(
			{ imageDimensionRequests: [{ resource: item.resource }] },
			[item],
			[admission(item)],
			"measure-resources",
			io.budget(limits),
		);
		expect(result.facts).toEqual([
			{ resource: item.resource, width: shape[0], height: shape[1] },
		]);
		result.close();
		result.close();
		expect(io.bitmaps[0].closes).toBe(1);
	}
});

test("measurement decodes only requested nodes, never unrelated declared images", async () => {
	const item = image(),
		unused = image("unused.png"),
		io = worker();
	const empty = await io.images(
		{},
		[item, unused],
		[],
		"measure-resources",
		io.budget(limits),
	);
	expect(empty.facts).toEqual([]);
	expect(io.calls()).toBe(0);
	empty.close();
	const used = await io.images(
		{ imageDimensionRequests: [{ resource: item.resource }] },
		[item, unused],
		[admission(item)],
		"measure-resources",
		io.budget(limits),
	);
	expect(io.calls()).toBe(1);
	used.close();
});

test("full image identity is independent of Rust/author JSON property order", async () => {
	const item = image(),
		io = worker();
	const reordered = Object.fromEntries(Object.entries(item.resource).reverse());
	const output = await io.images(
		{ imageDimensionRequests: [{ resource: reordered }] },
		[item],
		[admission(item)],
		"measure-resources",
		io.budget(limits),
	);
	expect(output.facts[0].width).toBe(3);
	output.close();
	const invalid = { ...reordered, invented: 1 };
	await expect(
		io.images(
			{ imageDimensionRequests: [{ resource: invalid }] },
			[item],
			[admission(item)],
			"measure-resources",
			io.budget(limits),
		),
	).rejects.toThrow();
});

test("identity, duplicate requests and missing admission fail before allocation", async () => {
	const item = image();
	const cases = [
		{ resources: [item], admissions: [] },
		{
			resources: [item],
			admissions: [
				{ ...admission(item), resource: image("wrong.png").resource },
			],
		},
		{
			resources: [{ ...item, body: new ArrayBuffer(2) }],
			admissions: [admission(item)],
		},
		{ resources: [item, item], admissions: [admission(item), admission(item)] },
		{
			resources: [item],
			admissions: [{ ...admission(item), decodedBytes: 0 }],
		},
	];
	for (const c of cases) {
		const io = worker();
		await expect(
			io.images({}, c.resources, c.admissions, "render", io.budget(limits)),
		).rejects.toThrow();
		expect(io.calls()).toBe(0);
	}
});

test("all allocated static images close on malformed raster or subsequent decode error", async () => {
	const items = [image(), image("second.png")];
	for (const shapes of [[[9, 2]], [[3, 2], Error("corrupt raster")]] as (
		| [number, number]
		| Error
	)[][]) {
		const io = worker(shapes);
		await expect(
			io.images(
				{},
				items,
				items.map((item) => admission(item)),
				"render",
				io.budget(limits),
			),
		).rejects.toThrow();
		expect(io.bitmaps.length).toBe(1);
		expect(io.bitmaps[0].closes).toBe(1);
	}
});

test("static and selected sequence images share one physical allocation budget", async () => {
	const item = image(),
		other = image("frame.png"),
		io = worker([
			[3, 2],
			[3, 2],
		]);
	const shared = io.budget({ ...limits, maxDecodedBytes: 24 });
	const staticImages = await io.images(
		{},
		[item],
		[admission(item)],
		"render",
		shared,
	);
	const selected = {
		imageKey: "sequence:0",
		resource: other.resource,
		width: 3,
		height: 2,
	};
	await expect(
		io.sequences(
			{ sequenceImages: [selected], sequenceLimits: limits },
			[{ ...other, imageKey: selected.imageKey }],
			shared,
		),
	).rejects.toThrow("Combined image decode budget");
	expect(io.calls()).toBe(1);
	staticImages.close();
	expect(io.bitmaps[0].closes).toBe(1);
});
