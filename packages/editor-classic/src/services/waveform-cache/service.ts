"use client";

import type { SessionResources } from "../../editor/session/resources";
import {
	buildSourceWaveformSummary,
	type SourceWaveformSummary,
} from "../../media/waveform-summary";

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
	private summaries = new Map<string, SummaryEntry>();
	private sourceGenerations = new Map<string, number>();
	private pendingOperations = new Set<Promise<unknown>>();
	private cacheGeneration = 0;
	private disposed = false;

	constructor(private readonly resources: WaveformCacheResources) {}

	getSourceSummary({
		sourceKey,
		audioBuffer,
		sourceFile,
		audioUrl,
	}: GetSourceWaveformSummaryArgs): Promise<SourceWaveformSummary> {
		if (this.disposed) {
			return Promise.reject(new Error("Waveform cache is disposed."));
		}
		const existing = this.summaries.get(sourceKey);
		if (existing) return existing.promise;

		const token = this.createToken({ sourceKey });
		const controller = new AbortController();
		const promise = this.buildSummary({
			sourceKey,
			audioBuffer,
			sourceFile,
			audioUrl,
			token,
			signal: controller.signal,
		})
			.then((summary) => {
				this.assertCurrent({ token, signal: controller.signal });
				return summary;
			})
			.catch((error) => {
				const current = this.summaries.get(sourceKey);
				if (current?.token === token && current.controller === controller) {
					this.summaries.delete(sourceKey);
				}
				if (!this.isTokenCurrent(token) || controller.signal.aborted) {
					throw this.invalidatedError({ sourceKey });
				}
				throw error;
			});
		const entry: SummaryEntry = { token, controller, promise };
		this.summaries.set(sourceKey, entry);
		this.trackPending(promise);
		return promise;
	}

	clearSource({ sourceKey }: { sourceKey: string }): Promise<void> {
		this.sourceGenerations.set(
			sourceKey,
			(this.sourceGenerations.get(sourceKey) ?? 0) + 1,
		);
		const entry = this.summaries.get(sourceKey);
		this.summaries.delete(sourceKey);
		entry?.controller.abort();
		return this.settlePending();
	}

	clearAll(): Promise<void> {
		this.cacheGeneration += 1;
		for (const entry of this.summaries.values()) entry.controller.abort();
		this.summaries.clear();
		this.sourceGenerations.clear();
		return this.settlePending();
	}

	dispose(): Promise<void> {
		if (!this.disposed) {
			this.disposed = true;
			this.cacheGeneration += 1;
			for (const entry of this.summaries.values()) entry.controller.abort();
			this.summaries.clear();
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

		let arrayBuffer: ArrayBuffer | null = null;
		if (sourceFile) {
			arrayBuffer = await sourceFile.arrayBuffer();
		} else if (audioUrl) {
			const response = await fetch(audioUrl, { signal });
			this.assertCurrent({ token, signal });
			if (!response.ok) {
				throw new Error(`Failed to fetch waveform source: ${response.status}`);
			}
			arrayBuffer = await response.arrayBuffer();
		}
		this.assertCurrent({ token, signal });

		if (!arrayBuffer) {
			throw new Error(`No waveform source available for ${sourceKey}`);
		}

		const audioHandle = this.resources.createAudioContext({});
		if (!audioHandle.context) {
			await audioHandle.close();
			throw new Error("Audio waveform decoding is unavailable on this Host.");
		}
		try {
			const buffer = await audioHandle.context.decodeAudioData(
				arrayBuffer.slice(0),
			);
			this.assertCurrent({ token, signal });
			return buildSourceWaveformSummary({ sourceKey, buffer });
		} finally {
			await audioHandle.close();
		}
	}
}
