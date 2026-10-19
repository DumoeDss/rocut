"use client";

import type { SessionResources } from "../../editor/session/resources";
import {
	buildSourceWaveformSummary,
	type SourceWaveformSummary,
	withWaveformLevels,
} from "../../media/waveform-summary";
import {
	MAX_WAVEFORM_ENCODED_BYTES,
	waveformDecodeQueue,
	waveformUnsupported,
} from "./decode-budget";
import {
	decodeWaveformSource,
	type WaveformDecodeSourceArgs,
} from "./decode-source";
import {
	readWaveformSummary,
	summaryBytes,
	writeWaveformSummary,
} from "./summary-storage";

export interface WaveformCacheOptions {
	/** Injectable platform codec adapter for deterministic codec-independent ownership tests. */
	decodeSource?(args: WaveformDecodeSourceArgs): Promise<SourceWaveformSummary>;
	contentCache?: boolean;
}

interface GetSourceWaveformSummaryArgs {
	sourceKey: string;
	audioBuffer?: AudioBuffer;
	sourceFile?: File;
	audioUrl?: string;
}

interface WorkToken {
	readonly sourceKey: string;
	readonly cacheGeneration: number;
	readonly sourceGeneration: number;
	readonly activityGeneration: number | null;
}

interface SummaryEntry {
	readonly token: WorkToken;
	readonly controller: AbortController;
	readonly promise: Promise<SourceWaveformSummary>;
}

interface SourceEntries {
	readonly objects: WeakMap<AudioBuffer | File, SummaryEntry>;
	readonly pendingUrls: Map<string | undefined, SummaryEntry>;
	readonly readyUrls: Map<string, SummaryEntry>;
	readonly pending: Set<SummaryEntry>;
}

const MAX_READY_URLS_PER_SOURCE = 8;

interface WaveformCacheResources {
	getActivityGeneration?(): number;
	assertActivityGeneration?(args: { generation: number }): void;
	createAudioContext(
		args: Parameters<SessionResources["createAudioContext"]>[0],
	): {
		readonly context: Pick<AudioContext, "decodeAudioData"> | null;
		close(): Promise<void>;
	};
}

export class WaveformCache {
	private summaries = new Map<string, SourceEntries>();
	private sourceGenerations = new Map<string, number>();
	private pendingOperations = new Set<Promise<unknown>>();
	private cacheGeneration = 0;
	private disposed = false;
	private readyEntries = new Map<
		SummaryEntry,
		{ bytes: number; remove(): void }
	>();
	private contentPending = new Map<string, Promise<SourceWaveformSummary>>();

	private readonly resources: WaveformCacheResources;
	private readonly options: WaveformCacheOptions;
	constructor({
		resources,
		options = {},
	}: {
		resources: WaveformCacheResources;
		options?: WaveformCacheOptions;
	}) {
		this.resources = resources;
		this.options = options;
	}

	getSourceSummary({
		sourceKey,
		audioBuffer,
		sourceFile,
		audioUrl,
	}: GetSourceWaveformSummaryArgs): Promise<SourceWaveformSummary> {
		if (this.disposed) {
			return Promise.reject(new Error("Waveform cache is disposed."));
		}
		// Match buildSummary's precedence: a new object URL for the same File
		// must not cause another decode, while replacing that File must.
		const identity = audioBuffer ?? sourceFile ?? audioUrl;
		const objectIdentity = typeof identity === "object" ? identity : undefined;
		const urlIdentity = typeof identity === "string" ? identity : undefined;
		let sources = this.summaries.get(sourceKey);
		const existing = objectIdentity
			? sources?.objects.get(objectIdentity)
			: (sources?.pendingUrls.get(urlIdentity) ??
				(urlIdentity === undefined
					? undefined
					: sources?.readyUrls.get(urlIdentity)));
		if (
			existing &&
			sources &&
			!objectIdentity &&
			urlIdentity !== undefined &&
			sources.readyUrls.has(urlIdentity)
		) {
			sources.readyUrls.delete(urlIdentity);
			sources.readyUrls.set(urlIdentity, existing);
		}
		if (existing) {
			const ready = this.readyEntries.get(existing);
			if (ready) {
				this.readyEntries.delete(existing);
				this.readyEntries.set(existing, ready);
			}
			return existing.promise;
		}
		if (!sources) {
			sources = {
				objects: new WeakMap(),
				pendingUrls: new Map(),
				readyUrls: new Map(),
				pending: new Set(),
			};
			this.summaries.set(sourceKey, sources);
		}
		const sourceEntries = sources;

		const token = this.createToken({ sourceKey });
		const controller = new AbortController();
		const promise = waveformDecodeQueue
			.run({
				signal: controller.signal,
				work: () =>
					this.buildSummary({
						sourceKey,
						audioBuffer,
						sourceFile,
						audioUrl,
						token,
						signal: controller.signal,
					}),
			})
			.then((summary) => {
				this.assertCurrent({ token, signal: controller.signal });
				sourceEntries.pending.delete(entry);
				if (!objectIdentity) {
					sourceEntries.pendingUrls.delete(urlIdentity);
					if (urlIdentity !== undefined) {
						sourceEntries.readyUrls.set(urlIdentity, entry);
						if (sourceEntries.readyUrls.size > MAX_READY_URLS_PER_SOURCE) {
							const oldest = sourceEntries.readyUrls.keys().next().value;
							if (oldest !== undefined) sourceEntries.readyUrls.delete(oldest);
						}
					}
				}
				this.readyEntries.set(entry, {
					bytes: summaryBytes(summary),
					remove: () => {
						if (objectIdentity) sourceEntries.objects.delete(objectIdentity);
						else if (
							urlIdentity !== undefined &&
							sourceEntries.readyUrls.get(urlIdentity) === entry
						)
							sourceEntries.readyUrls.delete(urlIdentity);
						if (
							sourceEntries.pending.size === 0 &&
							![...this.readyEntries.keys()].some(
								(value) => value.token.sourceKey === sourceKey,
							) &&
							this.summaries.get(sourceKey) === sourceEntries
						)
							this.summaries.delete(sourceKey);
					},
				});
				let bytes = [...this.readyEntries.values()].reduce(
					(sum, value) => sum + value.bytes,
					0,
				);
				for (const [old, value] of this.readyEntries) {
					if (bytes <= 8 * 1024 * 1024 && this.readyEntries.size <= 64) break;
					this.readyEntries.delete(old);
					value.remove();
					bytes -= value.bytes;
				}
				return summary;
			})
			.catch((error) => {
				sourceEntries.pending.delete(entry);
				if (objectIdentity) {
					if (sourceEntries.objects.get(objectIdentity) === entry)
						sourceEntries.objects.delete(objectIdentity);
				} else if (sourceEntries.pendingUrls.get(urlIdentity) === entry) {
					sourceEntries.pendingUrls.delete(urlIdentity);
				}
				if (
					sourceEntries.pending.size === 0 &&
					![...this.readyEntries.keys()].some(
						(value) => value.token.sourceKey === sourceKey,
					) &&
					this.summaries.get(sourceKey) === sourceEntries
				)
					this.summaries.delete(sourceKey);
				if (!this.isTokenCurrent(token) || controller.signal.aborted) {
					throw this.invalidatedError({ sourceKey });
				}
				throw error;
			});
		const entry: SummaryEntry = { token, controller, promise };
		sourceEntries.pending.add(entry);
		if (objectIdentity) sourceEntries.objects.set(objectIdentity, entry);
		else sourceEntries.pendingUrls.set(urlIdentity, entry);
		this.trackPending(promise);
		return promise;
	}

	clearSource({ sourceKey }: { sourceKey: string }): Promise<void> {
		this.sourceGenerations.set(
			sourceKey,
			(this.sourceGenerations.get(sourceKey) ?? 0) + 1,
		);
		const entries = this.summaries.get(sourceKey);
		this.summaries.delete(sourceKey);
		for (const entry of this.readyEntries.keys())
			if (entry.token.sourceKey === sourceKey) this.readyEntries.delete(entry);
		for (const entry of entries?.pending ?? []) entry.controller.abort();
		return this.settlePending();
	}

	clearAll(): Promise<void> {
		this.cacheGeneration += 1;
		for (const entries of this.summaries.values()) {
			for (const entry of entries.pending) entry.controller.abort();
		}
		this.summaries.clear();
		this.readyEntries.clear();
		this.sourceGenerations.clear();
		return this.settlePending();
	}

	dispose(): Promise<void> {
		if (!this.disposed) {
			this.disposed = true;
			this.cacheGeneration += 1;
			for (const entries of this.summaries.values()) {
				for (const entry of entries.pending) entry.controller.abort();
			}
			this.summaries.clear();
			this.readyEntries.clear();
			this.sourceGenerations.clear();
		}
		return this.settlePending();
	}

	private createToken({ sourceKey }: { sourceKey: string }): WorkToken {
		const activityGeneration =
			typeof this.resources.getActivityGeneration === "function" &&
			typeof this.resources.assertActivityGeneration === "function"
				? this.resources.getActivityGeneration()
				: null;
		return {
			sourceKey,
			cacheGeneration: this.cacheGeneration,
			sourceGeneration: this.sourceGenerations.get(sourceKey) ?? 0,
			activityGeneration,
		};
	}

	private isTokenCurrent(token: WorkToken): boolean {
		if (
			!this.disposed &&
			token.cacheGeneration === this.cacheGeneration &&
			token.sourceGeneration ===
				(this.sourceGenerations.get(token.sourceKey) ?? 0)
		) {
			if (
				token.activityGeneration === null ||
				typeof this.resources.assertActivityGeneration !== "function"
			) {
				return true;
			}
			try {
				this.resources.assertActivityGeneration({
					generation: token.activityGeneration,
				});
				return true;
			} catch {
				return false;
			}
		}
		return false;
	}

	private assertCurrent({
		token,
		signal,
	}: {
		token: WorkToken;
		signal: AbortSignal;
	}): void {
		if (!this.isTokenCurrent(token) || signal.aborted) {
			throw this.invalidatedError({ sourceKey: token.sourceKey });
		}
	}

	private invalidatedError({ sourceKey }: { sourceKey: string }): Error {
		return new Error(`Waveform cache work for ${sourceKey} was invalidated.`);
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

	private async buildSummary({
		sourceKey,
		audioBuffer,
		sourceFile,
		audioUrl,
		token,
		signal,
	}: GetSourceWaveformSummaryArgs & {
		token: WorkToken;
		signal: AbortSignal;
	}): Promise<SourceWaveformSummary> {
		this.assertCurrent({ token, signal });
		if (audioBuffer) {
			const summary = buildSourceWaveformSummary({
				sourceKey,
				buffer: audioBuffer,
			});
			this.assertCurrent({ token, signal });
			return summary;
		}

		let file: Blob | undefined = sourceFile;
		if (sourceFile) {
			if (sourceFile.size > MAX_WAVEFORM_ENCODED_BYTES)
				throw waveformUnsupported(
					"Waveform source exceeds the 64 MiB input budget.",
				);
		} else if (audioUrl) {
			const response = await fetch(audioUrl, { signal });
			this.assertCurrent({ token, signal });
			if (!response.ok) {
				throw new Error(`Failed to fetch waveform source: ${response.status}`);
			}
			const length = Number(response.headers.get("content-length"));
			if (length > MAX_WAVEFORM_ENCODED_BYTES)
				throw waveformUnsupported(
					"Waveform source exceeds the 64 MiB input budget.",
				);
			if (!response.body)
				throw new Error("Waveform source has no response body.");
			const reader = response.body.getReader();
			const chunks: Uint8Array<ArrayBuffer>[] = [];
			let bytes = 0;
			try {
				while (true) {
					const chunk = await reader.read();
					if (chunk.done) break;
					bytes += chunk.value.byteLength;
					if (bytes > MAX_WAVEFORM_ENCODED_BYTES)
						throw waveformUnsupported(
							"Waveform source exceeds the 64 MiB input budget.",
						);
					chunks.push(new Uint8Array(chunk.value));
				}
				file = new Blob(chunks);
			} finally {
				await reader.cancel();
				reader.releaseLock();
			}
		}
		this.assertCurrent({ token, signal });

		if (!file) {
			throw new Error(`No waveform source available for ${sourceKey}`);
		}

		const decode = this.options.decodeSource ?? decodeWaveformSource;
		if (this.options.contentCache === false)
			return withWaveformLevels(await decode({ sourceKey, file, signal }));
		const digest = await crypto.subtle.digest(
			"SHA-256",
			await file.arrayBuffer(),
		);
		this.assertCurrent({ token, signal });
		const key = `waveform-v2:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
		const cached = await readWaveformSummary(key);
		this.assertCurrent({ token, signal });
		if (cached) return { ...cached, sourceKey };
		const pending = this.contentPending.get(key);
		if (pending) {
			try {
				return { ...(await pending), sourceKey };
			} catch {
				this.assertCurrent({
					token,
					signal,
				}); /* Another source owner was cancelled: decode this owner afresh. */
			}
		}
		const work = decode({ sourceKey, file, signal }).then(withWaveformLevels);
		this.contentPending.set(key, work);
		try {
			const summary = await work;
			this.assertCurrent({ token, signal });
			await writeWaveformSummary({ key, summary });
			return summary;
		} finally {
			if (this.contentPending.get(key) === work)
				this.contentPending.delete(key);
		}
	}
}
