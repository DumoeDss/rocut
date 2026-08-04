import {
	Input,
	ALL_FORMATS,
	BlobSource,
	CanvasSink,
	type WrappedCanvas,
} from "mediabunny";

interface WorkToken {
	readonly mediaId: string;
	readonly cacheGeneration: number;
	readonly mediaGeneration: number;
}

interface VideoSinkData {
	readonly token: WorkToken;
	input: Input;
	sink: CanvasSink;
	iterator: AsyncGenerator<WrappedCanvas, void, unknown> | null;
	currentFrame: WrappedCanvas | null;
	nextFrame: WrappedCanvas | null;
	lastTime: number;
	prefetching: boolean;
	prefetchPromise: Promise<void> | null;
	disposed: boolean;
}

export class VideoCache {
	private sinks = new Map<string, VideoSinkData>();
	private initPromises = new Map<string, Promise<void>>();
	private frameChain = new Map<string, Promise<unknown>>();
	private seekGenerations = new Map<string, number>();
	private mediaGenerations = new Map<string, number>();
	private pendingOperations = new Set<Promise<unknown>>();
	private cacheGeneration = 0;
	private disposed = false;

	async getFrameAt({
		mediaId,
		file,
		time,
	}: {
		mediaId: string;
		file: File;
		time: number;
	}): Promise<WrappedCanvas | null> {
		if (this.disposed) return null;
		const token = this.createToken({ mediaId });
		await this.ensureSink({ mediaId, file, token });
		if (!this.isTokenCurrent(token)) return null;

		const sinkData = this.sinks.get(mediaId);
		if (
			!sinkData ||
			!this.tokensEqual({ left: sinkData.token, right: token })
		) {
			return null;
		}

		const generation = (this.seekGenerations.get(mediaId) ?? 0) + 1;
		this.seekGenerations.set(mediaId, generation);

		const previous = this.frameChain.get(mediaId) ?? Promise.resolve();
		const current = previous.then(async () => {
			if (
				!this.isSinkCurrent(sinkData) ||
				this.seekGenerations.get(mediaId) !== generation
			) {
				return null;
			}
			const frame = await this.resolveFrame({ sinkData, time });
			return this.isSinkCurrent(sinkData) ? frame : null;
		});
		this.trackPending(current);
		this.frameChain.set(
			mediaId,
			current.catch(() => {}),
		);
		return current;
	}

	private createToken({ mediaId }: { mediaId: string }): WorkToken {
		return {
			mediaId,
			cacheGeneration: this.cacheGeneration,
			mediaGeneration: this.mediaGenerations.get(mediaId) ?? 0,
		};
	}

	private isTokenCurrent(token: WorkToken): boolean {
		return (
			!this.disposed &&
			token.cacheGeneration === this.cacheGeneration &&
			token.mediaGeneration === (this.mediaGenerations.get(token.mediaId) ?? 0)
		);
	}

	private tokensEqual({
		left,
		right,
	}: {
		left: WorkToken;
		right: WorkToken;
	}): boolean {
		return (
			left.mediaId === right.mediaId &&
			left.cacheGeneration === right.cacheGeneration &&
			left.mediaGeneration === right.mediaGeneration
		);
	}

	private isSinkCurrent(sinkData: VideoSinkData): boolean {
		return (
			!sinkData.disposed &&
			this.isTokenCurrent(sinkData.token) &&
			this.sinks.get(sinkData.token.mediaId) === sinkData
		);
	}

	private trackPending<T>(promise: Promise<T>): Promise<T> {
		this.pendingOperations.add(promise);
		void promise.then(
			() => this.pendingOperations.delete(promise),
			() => this.pendingOperations.delete(promise),
		);
		return promise;
	}

	private settlePending(): Promise<void> {
		const pending = [...this.pendingOperations];
		if (pending.length === 0) return Promise.resolve();
		return Promise.allSettled(pending).then(() => undefined);
	}

	private async resolveFrame({
		sinkData,
		time,
	}: {
		sinkData: VideoSinkData;
		time: number;
	}): Promise<WrappedCanvas | null> {
		if (!this.isSinkCurrent(sinkData)) return null;
		if (sinkData.nextFrame && sinkData.nextFrame.timestamp <= time) {
			sinkData.currentFrame = sinkData.nextFrame;
			sinkData.nextFrame = null;
			this.startPrefetch({ sinkData });
		}

		if (
			sinkData.currentFrame &&
			this.isFrameValid({ frame: sinkData.currentFrame, time })
		) {
			if (!sinkData.nextFrame && !sinkData.prefetching) {
				this.startPrefetch({ sinkData });
			}
			return sinkData.currentFrame;
		}

		if (
			sinkData.iterator &&
			sinkData.currentFrame &&
			time >= sinkData.lastTime &&
			time < sinkData.lastTime + 2.0
		) {
			const frame = await this.iterateToTime({ sinkData, targetTime: time });
			if (!this.isSinkCurrent(sinkData)) return null;
			if (frame) {
				if (!sinkData.nextFrame && !sinkData.prefetching) {
					this.startPrefetch({ sinkData });
				}
				return frame;
			}
		}

		const frame = await this.seekToTime({ sinkData, time });
		if (!this.isSinkCurrent(sinkData)) return null;
		if (frame && !sinkData.nextFrame && !sinkData.prefetching) {
			this.startPrefetch({ sinkData });
		}
		return frame;
	}

	private isFrameValid({
		frame,
		time,
	}: {
		frame: WrappedCanvas;
		time: number;
	}): boolean {
		return time >= frame.timestamp && time < frame.timestamp + frame.duration;
	}

	private async iterateToTime({
		sinkData,
		targetTime,
	}: {
		sinkData: VideoSinkData;
		targetTime: number;
	}): Promise<WrappedCanvas | null> {
		if (!sinkData.iterator || !this.isSinkCurrent(sinkData)) return null;

		try {
			while (this.isSinkCurrent(sinkData)) {
				if (sinkData.prefetching && sinkData.prefetchPromise) {
					await sinkData.prefetchPromise;
					if (!this.isSinkCurrent(sinkData)) return null;
				}

				if (
					sinkData.nextFrame &&
					sinkData.nextFrame.timestamp <= targetTime + 0.05
				) {
					sinkData.currentFrame = sinkData.nextFrame;
					sinkData.nextFrame = null;
				} else {
					const iterator: AsyncGenerator<WrappedCanvas, void, unknown> | null =
						sinkData.iterator;
					if (!iterator) return null;
					const { value: frame, done } = await iterator.next();
					if (!this.isSinkCurrent(sinkData) || sinkData.iterator !== iterator) {
						return null;
					}
					if (done || !frame) break;
					sinkData.currentFrame = frame;
				}

				const frame = sinkData.currentFrame;
				if (!frame) break;
				sinkData.lastTime = frame.timestamp;
				if (this.isFrameValid({ frame, time: targetTime })) return frame;
				if (frame.timestamp > targetTime + 1.0) break;
			}
		} catch (error) {
			if (this.isSinkCurrent(sinkData)) {
				console.warn("Iterator failed, will restart:", error);
				sinkData.iterator = null;
			}
		}

		return null;
	}

	private async seekToTime({
		sinkData,
		time,
	}: {
		sinkData: VideoSinkData;
		time: number;
	}): Promise<WrappedCanvas | null> {
		try {
			if (!this.isSinkCurrent(sinkData)) return null;
			if (sinkData.prefetching && sinkData.prefetchPromise) {
				await sinkData.prefetchPromise;
				if (!this.isSinkCurrent(sinkData)) return null;
			}

			if (sinkData.iterator) {
				await sinkData.iterator.return();
				if (!this.isSinkCurrent(sinkData)) return null;
				sinkData.iterator = null;
			}

			sinkData.nextFrame = null;
			const iterator = sinkData.sink.canvases(time);
			sinkData.iterator = iterator;
			sinkData.lastTime = time;
			const { value: frame } = await iterator.next();
			if (!this.isSinkCurrent(sinkData) || sinkData.iterator !== iterator) {
				return null;
			}

			if (frame) {
				sinkData.currentFrame = frame;
				this.startPrefetch({ sinkData });
				return frame;
			}
		} catch (error) {
			if (this.isSinkCurrent(sinkData)) {
				console.warn("Failed to seek video:", error);
			}
		}

		return null;
	}

	private startPrefetch({ sinkData }: { sinkData: VideoSinkData }): void {
		if (
			!this.isSinkCurrent(sinkData) ||
			sinkData.prefetching ||
			!sinkData.iterator ||
			sinkData.nextFrame
		) {
			return;
		}

		sinkData.prefetching = true;
		const promise = this.prefetchNextFrame({ sinkData });
		sinkData.prefetchPromise = promise;
		this.trackPending(promise);
	}

	private async prefetchNextFrame({
		sinkData,
	}: {
		sinkData: VideoSinkData;
	}): Promise<void> {
		const iterator = sinkData.iterator;
		if (!iterator || !this.isSinkCurrent(sinkData)) return;

		try {
			const { value: frame, done } = await iterator.next();
			if (!this.isSinkCurrent(sinkData) || sinkData.iterator !== iterator) {
				return;
			}
			if (!done && frame) sinkData.nextFrame = frame;
		} catch (error) {
			if (this.isSinkCurrent(sinkData)) {
				console.warn("Prefetch failed:", error);
				sinkData.iterator = null;
			}
		} finally {
			sinkData.prefetching = false;
			sinkData.prefetchPromise = null;
		}
	}

	private async ensureSink({
		mediaId,
		file,
		token,
	}: {
		mediaId: string;
		file: File;
		token: WorkToken;
	}): Promise<void> {
		if (!this.isTokenCurrent(token) || this.sinks.has(mediaId)) return;

		const existing = this.initPromises.get(mediaId);
		if (existing) {
			await existing;
			return;
		}

		const initPromise = this.trackPending(
			this.initializeSink({ mediaId, file, token }),
		);
		this.initPromises.set(mediaId, initPromise);

		try {
			await initPromise;
		} finally {
			if (this.initPromises.get(mediaId) === initPromise) {
				this.initPromises.delete(mediaId);
			}
		}
	}

	private async initializeSink({
		mediaId,
		file,
		token,
	}: {
		mediaId: string;
		file: File;
		token: WorkToken;
	}): Promise<void> {
		const input = new Input({
			source: new BlobSource(file),
			formats: ALL_FORMATS,
		});
		let published = false;

		try {
			const videoTrack = await input.getPrimaryVideoTrack();
			if (!this.isTokenCurrent(token)) return;
			if (!videoTrack) throw new Error("No video track found");

			const canDecode = await videoTrack.canDecode();
			if (!this.isTokenCurrent(token)) return;
			if (!canDecode) {
				throw new Error("Video codec not supported for decoding");
			}

			const sink = new CanvasSink(videoTrack, {
				poolSize: 3,
				fit: "contain",
			});
			if (!this.isTokenCurrent(token)) return;

			this.sinks.set(mediaId, {
				token,
				input,
				sink,
				iterator: null,
				currentFrame: null,
				nextFrame: null,
				lastTime: -1,
				prefetching: false,
				prefetchPromise: null,
				disposed: false,
			});
			published = true;
		} catch (error) {
			if (this.isTokenCurrent(token)) {
				console.error(`Failed to initialize video sink for ${mediaId}:`, error);
				throw error;
			}
		} finally {
			if (!published) input.dispose();
		}
	}

	clearVideo({ mediaId }: { mediaId: string }): Promise<void> {
		this.mediaGenerations.set(
			mediaId,
			(this.mediaGenerations.get(mediaId) ?? 0) + 1,
		);
		const sinkData = this.sinks.get(mediaId);
		this.sinks.delete(mediaId);
		if (sinkData) this.teardownSink(sinkData);
		this.initPromises.delete(mediaId);
		this.frameChain.delete(mediaId);
		this.seekGenerations.delete(mediaId);
		return this.settlePending();
	}

	clearAll(): Promise<void> {
		this.cacheGeneration += 1;
		const sinkData = [...this.sinks.values()];
		this.sinks.clear();
		for (const sink of sinkData) this.teardownSink(sink);
		this.initPromises.clear();
		this.frameChain.clear();
		this.seekGenerations.clear();
		this.mediaGenerations.clear();
		return this.settlePending();
	}

	dispose(): Promise<void> {
		if (!this.disposed) {
			this.disposed = true;
			this.cacheGeneration += 1;
			const sinkData = [...this.sinks.values()];
			this.sinks.clear();
			for (const sink of sinkData) this.teardownSink(sink);
			this.initPromises.clear();
			this.frameChain.clear();
			this.seekGenerations.clear();
			this.mediaGenerations.clear();
		}
		return this.settlePending();
	}

	private teardownSink(sinkData: VideoSinkData): void {
		if (sinkData.disposed) return;
		sinkData.disposed = true;
		const iterator = sinkData.iterator;
		sinkData.iterator = null;
		sinkData.currentFrame = null;
		sinkData.nextFrame = null;
		if (iterator) {
			try {
				this.trackPending(
					Promise.resolve(iterator.return()).then(() => undefined),
				);
			} catch (error) {
				console.warn("Failed to close video iterator:", error);
			}
		}
		sinkData.input.dispose();
	}

	getStats() {
		return {
			totalSinks: this.sinks.size,
			activeSinks: Array.from(this.sinks.values()).filter((s) => s.iterator)
				.length,
			cachedFrames: Array.from(this.sinks.values()).filter(
				(s) => s.currentFrame,
			).length,
		};
	}
}
