import type { ElementAnimations, ScalarAnimationChannel } from "./types";
import {
	sampleScalarAnimationBatch,
	type ScalarAnimationSampleCore,
	type ScalarAnimationSampleItem,
} from "../wasm/scalar-animation";

export function isScalarChannelData(
	value: unknown,
): value is ScalarAnimationChannel {
	if (typeof value !== "object" || value === null || !("keys" in value)) {
		return false;
	}
	const keys = (value as { keys: unknown }).keys;
	return (
		Array.isArray(keys) &&
		keys.some((key) => typeof key === "object" && key !== null && "segmentToNext" in key)
	);
}

/**
 * Batched scalar sampling for one element at one local time.
 *
 * Collects every scalar channel a resolve needs, performs a single
 * scalar-f64-v1 batch round-trip, and exposes per-path results. Discrete
 * channels and absent channels fall back to caller-provided values, so
 * ordinary linear and hold behavior stays on the existing path.
 */
export class ScalarBatchResolver {
	private readonly time: number;
	private readonly entries = new Map<string, ScalarAnimationSampleItem>();
	private results: ReadonlyMap<string, number> | null = null;
	private readonly coreOverride?: ScalarAnimationSampleCore;

	constructor({
		time,
		core,
	}: {
		readonly time: number;
		readonly core?: ScalarAnimationSampleCore;
	}) {
		this.time = time;
		this.coreOverride = core;
	}

	static withCore({
		time,
		core,
	}: {
		readonly time: number;
		readonly core: ScalarAnimationSampleCore;
	}): ScalarBatchResolver {
		return new ScalarBatchResolver({ time, core });
	}

	plan({
		animations,
		paths,
	}: {
		readonly animations: ElementAnimations | undefined;
		readonly paths: readonly string[];
	}): void {
		for (const path of paths) {
			if (this.entries.has(path)) continue;
			const data = animations?.[path];
			if (
				!data ||
				typeof data !== "object" ||
				Array.isArray(data) ||
				!("keys" in data)
			) {
				continue;
			}
			if (!isScalarChannelData(data)) continue;
			const channel = data;
			if (channel.keys.length === 0) continue;
			this.entries.set(path, {
				id: path,
				channel,
				fallbackValue: 0,
				times: [this.time],
			});
		}
	}

	execute(): void {
		if (this.results) return;
		if (this.entries.size === 0) {
			this.results = new Map();
			return;
		}
		const values = sampleScalarAnimationBatch({
			items: [...this.entries.values()],
			core: this.coreOverride,
		});
		const results = new Map<string, number>();
		for (const [index, item] of [...this.entries.values()].entries()) {
			const row = values[index];
			if (!row || row.length !== 1) {
				throw new TypeError("Scalar batch sampling returned misaligned results.");
			}
			results.set(item.id, row[0]);
		}
		this.results = results;
	}

	sample({
		path,
		fallbackValue,
	}: {
		readonly path: string;
		readonly fallbackValue: number;
	}): number {
		if (!this.results) {
			throw new TypeError("Scalar batch results were read before execute().");
		}
		const value = this.results.get(path);
		return value === undefined ? fallbackValue : value;
	}

	has({ path }: { readonly path: string }): boolean {
		return this.results?.has(path) ?? this.entries.has(path);
	}
}
