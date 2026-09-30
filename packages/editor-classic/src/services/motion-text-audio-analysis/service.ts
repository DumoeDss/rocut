"use client";

import type { SessionResources } from "../../editor/session/resources";
import { decodeAudioToFloat32, type DecodedAudio } from "../../media/audio";
import type { MediaAsset } from "../../media/types";
import {
	analyzeMotionTextAudio,
	MOTION_TEXT_AUDIO_ANALYSIS_VERSION,
	type MotionTextAudioAnalysis,
	type MotionTextAudioDiagnostic,
} from "../../wasm/motion-text-audio";

export interface MotionTextAudioAnalysisResources extends Pick<
	SessionResources,
	"createAudioContext"
> {
	getActivityGeneration?(): number;
	assertActivityGeneration?(args: { generation: number }): void;
}

interface AnalysisToken {
	readonly sourceKey: string;
	readonly cacheGeneration: number;
	readonly sourceGeneration: number;
	readonly activityGeneration: number | null;
}

interface PendingEntry {
	readonly token: AnalysisToken;
	readonly controller: AbortController;
	readonly promise: Promise<MotionTextAudioAnalysisCacheValue>;
}

interface SourceResultEntry {
	readonly file: File;
	readonly cacheKey: string;
}

export interface MotionTextAudioAnalysisCacheValue {
	readonly projectId: string;
	readonly assetId: string;
	readonly contentDigest: string;
	readonly analysis: MotionTextAudioAnalysis;
	readonly diagnostics: readonly MotionTextAudioDiagnostic[];
}

export interface MotionTextAudioAnalysisDependencies {
	readonly digestFile: (args: {
		readonly file: File;
		readonly signal: AbortSignal;
	}) => Promise<string>;
	readonly decodeFile: (args: {
		readonly file: File;
		readonly resources: MotionTextAudioAnalysisResources;
	}) => Promise<DecodedAudio>;
	readonly analyzePcm: typeof analyzeMotionTextAudio;
}

export interface MotionTextAudioAnalysisCacheInspection {
	readonly cachedResults: number;
	readonly sourceResults: number;
	readonly pendingOperations: number;
	readonly disposed: boolean;
}

export class MotionTextAudioAnalysisInvalidatedError extends Error {
	readonly sourceKey: string;

	constructor({ sourceKey }: { readonly sourceKey: string }) {
		super(`Motion-text audio analysis for ${sourceKey} was invalidated.`);
		this.name = "MotionTextAudioAnalysisInvalidatedError";
		this.sourceKey = sourceKey;
	}
}

const DEFAULT_DEPENDENCIES: MotionTextAudioAnalysisDependencies = {
	digestFile: digestMotionTextAudioFile,
	decodeFile: async ({ file, resources }) =>
		await decodeAudioToFloat32({ audioBlob: file, resources }),
	analyzePcm: analyzeMotionTextAudio,
};

export class MotionTextAudioAnalysisCache {
	private readonly cachedResults = new Map<
		string,
		MotionTextAudioAnalysisCacheValue
	>();
	private readonly sourceResults = new Map<string, SourceResultEntry>();
	private readonly pending = new Map<string, PendingEntry>();
	private readonly pendingOperations = new Set<Promise<unknown>>();
	private readonly sourceGenerations = new Map<string, number>();
	private cacheGeneration = 0;
	private disposed = false;

	private readonly resources: MotionTextAudioAnalysisResources;
	private readonly dependencies: MotionTextAudioAnalysisDependencies;

	constructor({
		resources,
		dependencies = DEFAULT_DEPENDENCIES,
	}: {
		readonly resources: MotionTextAudioAnalysisResources;
		readonly dependencies?: MotionTextAudioAnalysisDependencies;
	}) {
		this.resources = resources;
		this.dependencies = dependencies;
	}

	getAnalysis({
		projectId,
		asset,
	}: {
		readonly projectId: string;
		readonly asset: MediaAsset;
	}): Promise<MotionTextAudioAnalysisCacheValue> {
		if (this.disposed) {
			return Promise.reject(
				new Error("Motion-text audio analysis cache is disposed."),
			);
		}
		const sourceKey = buildSourceKey({ projectId, assetId: asset.id });
		const completed = this.sourceResults.get(sourceKey);
		if (completed?.file === asset.file) {
			const cached = this.cachedResults.get(completed.cacheKey);
			if (cached) return Promise.resolve(cached);
		}
		const existing = this.pending.get(sourceKey);
		if (existing) return existing.promise;

		const token = this.createToken({ sourceKey });
		const controller = new AbortController();
		const promise = this.buildAnalysis({
			projectId,
			asset,
			token,
			signal: controller.signal,
		})
			.then((value) => {
				this.assertCurrent({ token, signal: controller.signal });
				return value;
			})
			.catch((error: unknown) => {
				if (!this.isTokenCurrent(token) || controller.signal.aborted) {
					throw new MotionTextAudioAnalysisInvalidatedError({ sourceKey });
				}
				throw error;
			});
		const entry: PendingEntry = { token, controller, promise };
		this.pending.set(sourceKey, entry);
		void promise.then(
			() => this.removePending({ sourceKey, entry }),
			() => this.removePending({ sourceKey, entry }),
		);
		this.trackPending(promise);
		return promise;
	}

	async clearSource({
		projectId,
		assetId,
	}: {
		readonly projectId: string;
		readonly assetId: string;
	}): Promise<void> {
		const sourceKey = buildSourceKey({ projectId, assetId });
		this.invalidateSource(sourceKey);
		for (const [cacheKey, value] of this.cachedResults) {
			if (value.projectId === projectId && value.assetId === assetId) {
				this.cachedResults.delete(cacheKey);
			}
		}
		await this.settlePending();
	}

	async clearProject({
		projectId,
	}: {
		readonly projectId: string;
	}): Promise<void> {
		const prefix = JSON.stringify([projectId]).slice(0, -1);
		const sourceKeys = new Set([
			...this.pending.keys(),
			...this.sourceResults.keys(),
			...this.sourceGenerations.keys(),
		]);
		for (const sourceKey of sourceKeys) {
			if (sourceKey.startsWith(prefix)) this.invalidateSource(sourceKey);
		}
		for (const [cacheKey, value] of this.cachedResults) {
			if (value.projectId === projectId) this.cachedResults.delete(cacheKey);
		}
		await this.settlePending();
	}

	async clearAll(): Promise<void> {
		this.cacheGeneration += 1;
		for (const entry of this.pending.values()) entry.controller.abort();
		this.pending.clear();
		this.sourceResults.clear();
		this.sourceGenerations.clear();
		this.cachedResults.clear();
		await this.settlePending();
	}

	async dispose(): Promise<void> {
		if (!this.disposed) {
			this.disposed = true;
			await this.clearAll();
			return;
		}
		await this.settlePending();
	}

	inspect(): MotionTextAudioAnalysisCacheInspection {
		return {
			cachedResults: this.cachedResults.size,
			sourceResults: this.sourceResults.size,
			pendingOperations: this.pendingOperations.size,
			disposed: this.disposed,
		};
	}

	private async buildAnalysis({
		projectId,
		asset,
		token,
		signal,
	}: {
		readonly projectId: string;
		readonly asset: MediaAsset;
		readonly token: AnalysisToken;
		readonly signal: AbortSignal;
	}): Promise<MotionTextAudioAnalysisCacheValue> {
		this.assertCurrent({ token, signal });
		const contentDigest = await this.dependencies.digestFile({
			file: asset.file,
			signal,
		});
		this.assertCurrent({ token, signal });
		const cacheKey = buildCacheKey({
			projectId,
			assetId: asset.id,
			contentDigest,
		});
		const cached = this.cachedResults.get(cacheKey);
		if (cached) {
			this.sourceResults.set(token.sourceKey, { file: asset.file, cacheKey });
			return cached;
		}

		const decoded = await this.dependencies.decodeFile({
			file: asset.file,
			resources: this.resources,
		});
		this.assertCurrent({ token, signal });
		const result = this.dependencies.analyzePcm({
			samples: decoded.samples,
			sampleRate: decoded.sampleRate,
		});
		this.assertCurrent({ token, signal });
		if (!result.analysis) {
			const diagnostic = result.diagnostics.find(
				(entry) => entry.severity === "error",
			);
			throw new Error(
				diagnostic?.message ?? "Motion-text audio analysis returned no result.",
			);
		}
		const value: MotionTextAudioAnalysisCacheValue = {
			projectId,
			assetId: asset.id,
			contentDigest,
			analysis: result.analysis,
			diagnostics: result.diagnostics,
		};
		this.cachedResults.set(cacheKey, value);
		this.sourceResults.set(token.sourceKey, { file: asset.file, cacheKey });
		return value;
	}

	private createToken({
		sourceKey,
	}: {
		readonly sourceKey: string;
	}): AnalysisToken {
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

	private isTokenCurrent(token: AnalysisToken): boolean {
		if (
			this.disposed ||
			token.cacheGeneration !== this.cacheGeneration ||
			token.sourceGeneration !==
				(this.sourceGenerations.get(token.sourceKey) ?? 0)
		) {
			return false;
		}
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

	private assertCurrent({
		token,
		signal,
	}: {
		readonly token: AnalysisToken;
		readonly signal: AbortSignal;
	}): void {
		if (!this.isTokenCurrent(token) || signal.aborted) {
			throw new MotionTextAudioAnalysisInvalidatedError({
				sourceKey: token.sourceKey,
			});
		}
	}

	private invalidateSource(sourceKey: string): void {
		this.sourceGenerations.set(
			sourceKey,
			(this.sourceGenerations.get(sourceKey) ?? 0) + 1,
		);
		this.sourceResults.delete(sourceKey);
		const entry = this.pending.get(sourceKey);
		this.pending.delete(sourceKey);
		entry?.controller.abort();
	}

	private removePending({
		sourceKey,
		entry,
	}: {
		readonly sourceKey: string;
		readonly entry: PendingEntry;
	}): void {
		if (this.pending.get(sourceKey) === entry) this.pending.delete(sourceKey);
	}

	private trackPending<T>(promise: Promise<T>): Promise<T> {
		this.pendingOperations.add(promise);
		void promise.then(
			() => this.pendingOperations.delete(promise),
			() => this.pendingOperations.delete(promise),
		);
		return promise;
	}

	private async settlePending(): Promise<void> {
		const pending = [...this.pendingOperations];
		if (pending.length > 0) await Promise.allSettled(pending);
	}
}

export async function digestMotionTextAudioFile({
	file,
	signal,
}: {
	readonly file: File;
	readonly signal: AbortSignal;
}): Promise<string> {
	if (signal.aborted)
		throw new DOMException("Audio analysis aborted.", "AbortError");
	const bytes = await file.arrayBuffer();
	if (signal.aborted)
		throw new DOMException("Audio analysis aborted.", "AbortError");
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	if (signal.aborted)
		throw new DOMException("Audio analysis aborted.", "AbortError");
	return `sha256:${[...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("")}`;
}

function buildSourceKey({
	projectId,
	assetId,
}: {
	readonly projectId: string;
	readonly assetId: string;
}): string {
	return JSON.stringify([projectId, assetId]);
}

function buildCacheKey({
	projectId,
	assetId,
	contentDigest,
}: {
	readonly projectId: string;
	readonly assetId: string;
	readonly contentDigest: string;
}): string {
	return JSON.stringify([
		projectId,
		assetId,
		contentDigest,
		MOTION_TEXT_AUDIO_ANALYSIS_VERSION,
	]);
}
