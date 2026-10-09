import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type {
	ProgrammaticResource,
	SequenceImage,
} from "@opencut/editor-contracts";
import { isProgrammaticResource } from "@opencut/editor-contracts";
import type { ProgrammaticFrameProvider } from "@opencut/editor-ports/host";
import type { ProgrammaticFrame } from "../programmatic/frame";
import { resolveCanvasSequenceImages } from "../programmatic/image-sequence-resources";
import { imageSequencePng } from "../../../../../../script/fixtures/image-sequence-png";

function image({
	ordinal,
	body = imageSequencePng(ordinal),
}: {
	ordinal: number;
	body?: Uint8Array<ArrayBuffer>;
}) {
	const sha256 = createHash("sha256").update(body).digest("hex");
	const resource: ProgrammaticResource = {
		id: `frames/${ordinal}.png`,
		kind: "image",
		mimeType: "image/png",
		byteLength: body.byteLength,
		sha256,
		attachmentKey: `programmatic-sha256-${sha256}`,
	};
	const selected: SequenceImage = {
		imageKey: `sequence:${ordinal}`,
		ordinal,
		resource,
		manifestId: "shot/sequence.json",
		manifestSha256: "a".repeat(64),
		width: 2,
		height: 1,
		alpha: "straight",
	};
	return { selected, blob: new Blob([body], { type: resource.mimeType }) };
}

function frame(sequenceImages: readonly SequenceImage[]): ProgrammaticFrame {
	return {
		index: 0,
		time: 0,
		timelineTime: 0,
		sourceTime: 0,
		durationFrames: 1000,
		frameRate: { numerator: 30, denominator: 1 },
		seed: 1,
		sequenceImages,
		sequenceLimits: { maxDimension: 8192, maxDecodedBytes: 128 * 1024 * 1024 },
	};
}

function provider(
	load: (resource: ProgrammaticResource) => Promise<Blob>,
): ProgrammaticFrameProvider {
	return {
		renderPng: async () => {
			throw Error("Not an HTML source");
		},
		loadResource: async ({ resource }) => {
			if (!isProgrammaticResource(resource)) throw Error("Invalid descriptor");
			return load(resource);
		},
	};
}

test("loads only the two selected bodies from a 222-frame archive", async () => {
	const archive = Array.from({ length: 222 }, (_, ordinal) =>
		image({ ordinal }),
	);
	const reads: string[] = [];
	const frames = [archive[221], archive[5]];
	const result = await resolveCanvasSequenceImages({
		frame: frame(frames.map((entry) => entry.selected)),
		provider: provider(async (resource) => {
			reads.push(resource.id);
			const found = archive.find(
				(entry) => entry.selected.resource.id === resource.id,
			);
			if (!found) throw Error("Unexpected request");
			return found.blob;
		}),
		signal: new AbortController().signal,
	});
	expect(reads).toEqual(["frames/221.png", "frames/5.png"]);
	expect(result.map((entry) => entry.imageKey)).toEqual([
		"sequence:221",
		"sequence:5",
	]);
	expect(new Uint8Array(result[0].body)).toEqual(imageSequencePng(221));
	expect(new Uint8Array(result[1].body)).toEqual(imageSequencePng(5));
});

test("deduplicates identical selected bytes but retains per-instance descriptors", async () => {
	const first = image({ ordinal: 1 });
	const second = image({ ordinal: 2, body: imageSequencePng(1) });
	let reads = 0;
	const result = await resolveCanvasSequenceImages({
		frame: frame([first.selected, second.selected]),
		provider: provider(async () => {
			reads++;
			return first.blob;
		}),
		signal: new AbortController().signal,
	});
	expect(reads).toBe(1);
	expect(result[0].body).toBe(result[1].body);
	expect(result[1].resource.id).toBe("frames/2.png");
	expect(result[1].imageKey).toBe("sequence:2");
});

test("fails closed for absent provider, corrupt bytes, MIME or length", async () => {
	const first = image({ ordinal: 1 });
	const input = {
		frame: frame([first.selected]),
		signal: new AbortController().signal,
	};
	await expect(resolveCanvasSequenceImages(input)).rejects.toThrow(
		"cannot load",
	);
	for (const [blob, message] of [
		[
			new Blob([new Uint8Array(first.blob.size)], { type: "image/png" }),
			"digest mismatch",
		],
		[
			new Blob([imageSequencePng(1)], { type: "image/jpeg" }),
			"size/type mismatch",
		],
		[
			new Blob([new Uint8Array([1])], { type: "image/png" }),
			"size/type mismatch",
		],
	] as const) {
		await expect(
			resolveCanvasSequenceImages({
				...input,
				provider: provider(async () => blob),
			}),
		).rejects.toThrow(message);
	}
});

test("rejects dishonest declared geometry before returning bytes to the Worker", async () => {
	const first = image({ ordinal: 1 });
	await expect(
		resolveCanvasSequenceImages({
			frame: frame([{ ...first.selected, width: 1 }]),
			provider: provider(async () => first.blob),
			signal: new AbortController().signal,
		}),
	).rejects.toThrow();
});

test("cancellation stops the next attachment read and idle frames need no provider", async () => {
	const stop = new AbortController();
	let reads = 0;
	await expect(
		resolveCanvasSequenceImages({
			frame: frame([
				image({ ordinal: 1 }).selected,
				image({ ordinal: 2 }).selected,
			]),
			provider: provider(async () => {
				reads++;
				stop.abort(Error("sequence-stop"));
				return image({ ordinal: 1 }).blob;
			}),
			signal: stop.signal,
		}),
	).rejects.toThrow("sequence-stop");
	expect(reads).toBe(1);
	expect(
		await resolveCanvasSequenceImages({
			frame: frame([]),
			signal: new AbortController().signal,
		}),
	).toEqual([]);
	await expect(
		resolveCanvasSequenceImages({ frame: frame([]), signal: stop.signal }),
	).rejects.toThrow("sequence-stop");
});
