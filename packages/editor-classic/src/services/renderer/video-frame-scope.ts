import type { WrappedCanvas } from "mediabunny";
import type { VideoCache } from "../video-cache/service";
import { createCanvasSurface } from "./canvas-utils";

type Decoder = Pick<VideoCache, "getFrameAt">;
type Request = Parameters<Decoder["getFrameAt"]>[0];
type Sample = Promise<WrappedCanvas | null>;

// A decoder owns one mutable pool and latest-seek generation per media. Queue
// across render scopes too: an obsolete preview may still be resolving when
// another owner starts a capture. Never synthesize media IDs (clearVideo owns them).
const queues = new WeakMap<Decoder, Map<string, Promise<void>>>();

function snapshot({
	decoder,
	request,
}: {
	decoder: Decoder;
	request: Request;
}): Sample {
	let mediaQueues = queues.get(decoder);
	if (!mediaQueues) {
		mediaQueues = new Map();
		queues.set(decoder, mediaQueues);
	}
	const previous = mediaQueues.get(request.mediaId) ?? Promise.resolve();
	const sample = previous.then(async () => {
		const frame = await decoder.getFrameAt(request);
		if (!frame) return null;
		// Copy before releasing the queue, not after Promise.all: a later seek
		// can repaint the pooled canvas even when its object identity is unchanged.
		const { canvas, context } = createCanvasSurface({
			width: frame.canvas.width,
			height: frame.canvas.height,
		});
		context.drawImage(frame.canvas, 0, 0);
		return { ...frame, canvas };
	});
	const settled = sample.then(
		() => {},
		() => {},
	);
	mediaQueues.set(request.mediaId, settled);
	void settled.then(() => {
		if (mediaQueues.get(request.mediaId) === settled)
			mediaQueues.delete(request.mediaId);
	});
	return sample;
}

/** One frame resolution owns its samples; resolved nodes retain their canvases
 * until replaced. No decoder-owned canvas escapes into descriptors or exports. */
export function createVideoFrameScope(decoder: Decoder): Decoder {
	const samples = new Map<string, Map<File, Map<number, Sample>>>();
	return {
		getFrameAt(request) {
			let files = samples.get(request.mediaId);
			if (!files) {
				files = new Map();
				samples.set(request.mediaId, files);
			}
			let times = files.get(request.file);
			if (!times) {
				times = new Map();
				files.set(request.file, times);
			}
			const existing = times.get(request.time);
			if (existing) return existing;
			const sample = snapshot({ decoder, request });
			times.set(request.time, sample);
			return sample;
		},
	};
}
