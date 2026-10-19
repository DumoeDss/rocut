import { ALL_FORMATS, BlobSource, Input, VideoSampleSink } from "mediabunny";
import type { MediaPreviewProvider } from "@opencut/editor-ports/host";
import { renderThumbnailDataUrl } from "./thumbnail";
import { nativePreviewDataUrl } from "./preview-native-frame";
import {
	readPreview,
	writePreview,
	deletePreview,
	validatePreview,
	MAX_PREVIEW_STORAGE_BYTES,
} from "./preview-storage";

/** Every fixed rendering policy participates in invalidating derived frames. */
export const PREVIEW_PROFILE = Object.freeze({
	version: "frame-v2",
	maxWidth: 240,
	maxHeight: 720,
	orientation: "track-display-transform-v1",
	color: "browser-canvas2d-default-srgb-v1",
	encoding: "jpeg-quality-0.8-v1",
	sampling: "source-seconds-clamp-visible-video-range-minus-0.001-v2",
	native: "controlled-png-512px-1mib-to-profile-jpeg-v1",
});

export function previewPersistentKey({
	projectId,
	sha,
	time,
}: {
	projectId: string;
	sha: string;
	time: number;
}) {
	return JSON.stringify([PREVIEW_PROFILE, projectId, sha, time]);
}

export type MediaPreviewResult =
	| { status: "ready"; url: string }
	| { status: "offline" | "unsupported" | "failed"; error?: string };

type Entry = {
	file: File;
	time: number;
	users: number;
	controller: AbortController;
	promise: Promise<MediaPreviewResult>;
	resolve: (result: MediaPreviewResult) => void;
	settled: boolean;
	persistentKey?: string;
	bypassCache: boolean;
	priority: number;
	bytes: number;
	mediaId?: string;
	sourceSha256?: string;
};

const defaultStorage = {
	read: readPreview,
	write: writePreview,
	delete: deletePreview,
	validate: validatePreview,
};

/** Browser decoding is limited independently of the number of mounted clips. */
export class MediaPreviewResources {
	private readonly files = new WeakMap<File, number>();
	private nextFile = 0;
	private readonly entries = new Map<string, Entry>();
	private readonly queue: Entry[] = [];
	private active = 0;
	private readonly decode: typeof decodePreviewFrame;
	private readonly storage: typeof defaultStorage;
	private readonly nativeProvider?: MediaPreviewProvider;

	constructor(
		options:
			| {
					decode?: typeof decodePreviewFrame;
					storage?: typeof defaultStorage;
					nativeProvider?: MediaPreviewProvider;
			  }
			| typeof decodePreviewFrame = {},
	) {
		const config =
			typeof options === "function" ? { decode: options } : options;
		this.decode = config.decode ?? decodePreviewFrame;
		this.storage = config.storage ?? defaultStorage;
		this.nativeProvider = config.nativeProvider;
	}

	clearAll(): void {
		for (const entry of this.entries.values()) {
			entry.controller.abort();
			if (!entry.settled) {
				entry.settled = true;
				entry.resolve({ status: "failed", error: "Preview cancelled" });
			}
		}
		this.entries.clear();
		this.queue.length = 0;
	}

	acquire({
		file,
		time,
		sourceSha256,
		projectId,
		retry = false,
		priority = 0,
		mediaId,
	}: {
		file: File;
		time: number;
		sourceSha256?: string;
		projectId?: string;
		retry?: boolean;
		priority?: number;
		mediaId?: string;
	}) {
		if (!file.size)
			return {
				promise: Promise.resolve<MediaPreviewResult>({ status: "offline" }),
				release: () => {},
			};
		let id = this.files.get(file);
		if (id === undefined) this.files.set(file, (id = ++this.nextFile));
		const safeTime = Number.isFinite(time) ? Math.max(0, time) : 0;
		// Importers already compute SHA incrementally; never buffer a large File just to hash it here.
		const key = JSON.stringify([
			projectId ?? "session",
			sourceSha256 ? ["sha256", sourceSha256] : ["file", id],
			safeTime,
			PREVIEW_PROFILE,
		]);
		let entry = this.entries.get(key);
		if (entry) entry.priority = Math.max(entry.priority, priority);
		if (retry && entry?.settled) {
			this.entries.delete(key);
			entry = undefined;
		}
		if (!entry && this.queue.length >= 128) {
			return {
				promise: Promise.resolve<MediaPreviewResult>({
					status: "failed",
					error: "Preview queue is full. Scroll to retry.",
				}),
				release: () => {},
			};
		}
		if (!entry) {
			let resolve!: Entry["resolve"];
			const promise = new Promise<MediaPreviewResult>((done) => {
				resolve = done;
			});
			entry = {
				file,
				time: safeTime,
				users: 0,
				controller: new AbortController(),
				promise,
				resolve,
				settled: false,
				bypassCache: retry,
				priority,
				bytes: 0,
				mediaId,
				sourceSha256,
				persistentKey:
					sourceSha256 && projectId
						? previewPersistentKey({
								projectId,
								sha: sourceSha256,
								time: safeTime,
							})
						: undefined,
			};
			this.entries.set(key, entry);
			this.queue.push(entry);
		}
		entry.users++;
		this.pump();
		const owned = entry;
		let released = false;
		return {
			promise: entry.promise,
			release: () => {
				if (released) return;
				released = true;
				owned.users--;
				if (owned.users === 0 && !owned.settled) {
					owned.controller.abort();
					if (this.entries.get(key) === owned) this.entries.delete(key);
					const index = this.queue.indexOf(owned);
					if (index >= 0) {
						this.queue.splice(index, 1);
						owned.settled = true;
						owned.resolve({ status: "failed", error: "Preview cancelled" });
					}
				}
				this.trim();
			},
		};
	}

	private trim() {
		let bytes = [...this.entries.values()].reduce(
			(sum, entry) => sum + entry.bytes,
			0,
		);
		if (this.entries.size <= 96 && bytes <= MAX_PREVIEW_STORAGE_BYTES) return;
		for (const [key, entry] of this.entries) {
			// Leases retain their own promise/data URL even when the shared cache evicts it.
			if (
				entry.settled &&
				(!entry.users || bytes > MAX_PREVIEW_STORAGE_BYTES)
			) {
				this.entries.delete(key);
				bytes -= entry.bytes;
			}
			if (this.entries.size <= 96 && bytes <= MAX_PREVIEW_STORAGE_BYTES) break;
		}
	}

	private pump() {
		while (this.active < 2 && this.queue.length) {
			this.queue.sort((left, right) => right.priority - left.priority);
			const entry = this.queue.shift()!;
			if (entry.controller.signal.aborted) {
				entry.resolve({ status: "failed", error: "Preview cancelled" });
				continue;
			}
			this.active++;
			void this.loadCancellable(entry)
				.catch(
					(error: unknown): MediaPreviewResult => ({
						status: "failed",
						error:
							error instanceof Error
								? error.message
								: "Preview decoding failed",
					}),
				)
				.then((result) => {
					entry.bytes = result.status === "ready" ? result.url.length * 2 : 0;
					entry.settled = true;
					entry.resolve(result);
				})
				.finally(() => {
					this.active--;
					this.trim();
					this.pump();
				});
		}
	}

	private async loadCancellable(entry: Entry): Promise<MediaPreviewResult> {
		const signal = entry.controller.signal;
		const timeout = setTimeout(() => entry.controller.abort(), 15000);
		let cancel!: () => void;
		const cancelled = new Promise<MediaPreviewResult>((resolve) => {
			cancel = () => resolve({ status: "failed", error: "Preview cancelled" });
			signal.addEventListener("abort", cancel, { once: true });
			if (signal.aborted) cancel();
		});
		try {
			// Disposal cancels browser decoding, but a decoder's outstanding seek may never settle.
			return await Promise.race([this.load(entry), cancelled]);
		} finally {
			clearTimeout(timeout);
			signal.removeEventListener("abort", cancel);
		}
	}

	private async load(entry: Entry): Promise<MediaPreviewResult> {
		if (entry.bypassCache && entry.persistentKey)
			await this.storage.delete(entry.persistentKey);
		const cached = entry.persistentKey
			? !entry.bypassCache && (await this.storage.read(entry.persistentKey))
			: undefined;
		entry.controller.signal.throwIfAborted();
		if (cached) {
			const valid = await this.storage.validate(cached);
			entry.controller.signal.throwIfAborted();
			if (valid) return { status: "ready", url: cached };
			await this.storage.delete(entry.persistentKey!);
		}
		// Exactly one fresh decode per acquisition; a bad cache cannot cause a retry loop.
		let result: MediaPreviewResult;
		try {
			result = await this.decode({
				file: entry.file,
				time: entry.time,
				signal: entry.controller.signal,
			});
		} catch (error) {
			entry.controller.signal.throwIfAborted();
			result = {
				status: "failed",
				error:
					error instanceof Error ? error.message : "Preview decoding failed",
			};
		}
		if (
			(result.status === "failed" || result.status === "unsupported") &&
			this.nativeProvider &&
			entry.mediaId &&
			entry.sourceSha256
		) {
			entry.controller.signal.throwIfAborted();
			const frame = await this.nativeProvider.renderFrame({
				mediaId: entry.mediaId,
				sourceSha256: entry.sourceSha256,
				timeSeconds: entry.time,
				signal: entry.controller.signal,
			});
			if (frame)
				result = {
					status: "ready",
					url: await nativePreviewDataUrl({
						frame,
						signal: entry.controller.signal,
					}),
				};
		}
		entry.controller.signal.throwIfAborted();
		if (result.status === "ready" && entry.persistentKey)
			await this.storage.write({ key: entry.persistentKey, value: result.url });
		return result;
	}
}

export async function decodePreviewFrame({
	file,
	time,
	signal,
}: {
	file: File;
	time: number;
	signal: AbortSignal;
}): Promise<MediaPreviewResult> {
	if (!file.size) return { status: "offline" };
	const input = new Input({
		source: new BlobSource(file),
		formats: ALL_FORMATS,
	});
	const abort = () => input.dispose();
	signal.addEventListener("abort", abort, { once: true });
	try {
		signal.throwIfAborted();
		const track = await input.getPrimaryVideoTrack();
		if (!track || !(await track.canDecode())) return { status: "unsupported" };
		const firstTimestamp = await track.getFirstTimestamp();
		const endTimestamp = await track.computeDuration();
		// Track timestamps are absolute source seconds. Negative preroll is not
		// presented; an empty or indeterminate visible range has no poster.
		const startTimestamp = Math.max(0, firstTimestamp);
		if (
			!Number.isFinite(firstTimestamp) ||
			!Number.isFinite(endTimestamp) ||
			endTimestamp <= startTimestamp
		)
			return { status: "failed", error: "No visible video time range" };
		// Normalize invalid requests to the first visible time. The end guard
		// must never push a very short track below its first timestamp.
		const requestedTime = Number.isFinite(time) ? time : startTimestamp;
		const sampleTime = Math.max(
			startTimestamp,
			Math.min(requestedTime, Math.max(startTimestamp, endTimestamp - 0.001)),
		);
		const frame = await new VideoSampleSink(track).getSample(sampleTime);
		if (!frame)
			return {
				status: "failed",
				error: "No frame at the requested source time",
			};
		try {
			signal.throwIfAborted();
			return {
				status: "ready",
				url: renderThumbnailDataUrl({
					width: Math.min(PREVIEW_PROFILE.maxWidth, track.displayWidth),
					height:
						(Math.min(PREVIEW_PROFILE.maxWidth, track.displayWidth) *
							track.displayHeight) /
						track.displayWidth,
					draw: ({ context, width, height }) =>
						frame.draw(context, 0, 0, width, height),
				}),
			};
		} finally {
			frame.close();
		}
	} finally {
		signal.removeEventListener("abort", abort);
		input.dispose();
	}
}
