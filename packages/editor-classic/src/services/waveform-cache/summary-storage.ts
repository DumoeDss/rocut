import {
	type SourceWaveformSummary,
	withWaveformLevels,
} from "../../media/waveform-summary";

export const MAX_WAVEFORM_SUMMARY_BYTES = 2 * 1024 * 1024;
export const MAX_WAVEFORM_STORAGE_BYTES = 16 * 1024 * 1024;
export const MAX_WAVEFORM_STORAGE_COUNT = 64;
const memory = new Map<string, SourceWaveformSummary>();
const MAX_MEMORY_BYTES = 8 * 1024 * 1024;
let database: Promise<IDBDatabase | null> | undefined;

export function summaryBytes(summary: SourceWaveformSummary): number {
	return (
		summary.amplitudes.byteLength +
		(summary.levels ?? []).reduce((sum, level) => sum + level.byteLength, 0)
	);
}

export function validWaveformSummary(
	value: unknown,
): value is SourceWaveformSummary {
	if (!value || typeof value !== "object") return false;
	if (
		!("sourceKey" in value) ||
		!("sampleRate" in value) ||
		!("totalSamples" in value) ||
		!("bucketSize" in value) ||
		!("amplitudes" in value)
	)
		return false;
	const summary = value;
	return (
		typeof summary.sourceKey === "string" &&
		typeof summary.sampleRate === "number" &&
		Number.isFinite(summary.sampleRate) &&
		summary.sampleRate > 0 &&
		typeof summary.totalSamples === "number" &&
		Number.isSafeInteger(summary.totalSamples) &&
		summary.totalSamples > 0 &&
		typeof summary.bucketSize === "number" &&
		Number.isSafeInteger(summary.bucketSize) &&
		summary.bucketSize >= 1 &&
		summary.amplitudes instanceof Float32Array &&
		summary.amplitudes.length <= 262144 &&
		summary.amplitudes.length ===
			Math.ceil(summary.totalSamples / summary.bucketSize) &&
		summary.amplitudes.byteLength <= MAX_WAVEFORM_SUMMARY_BYTES &&
		summary.amplitudes.every((value) => Number.isFinite(value) && value >= 0)
	);
}

function remember({
	key,
	summary,
}: {
	key: string;
	summary: SourceWaveformSummary;
}): void {
	memory.delete(key);
	memory.set(key, summary);
	let bytes = [...memory.values()].reduce(
		(sum, value) => sum + summaryBytes(value),
		0,
	);
	while (memory.size > MAX_WAVEFORM_STORAGE_COUNT || bytes > MAX_MEMORY_BYTES) {
		const oldest = memory.entries().next().value;
		if (!oldest) break;
		memory.delete(oldest[0]);
		bytes -= summaryBytes(oldest[1]);
	}
}

function openDatabase(): Promise<IDBDatabase | null> {
	return (database ??= new Promise((resolve) => {
		if (typeof indexedDB === "undefined") {
			resolve(null);
			return;
		}
		const request = indexedDB.open("editor-derived-waveform-summaries-v1", 1);
		request.onupgradeneeded = () =>
			request.result.createObjectStore("summaries");
		request.onerror = request.onblocked = () => resolve(null);
		request.onsuccess = () => resolve(request.result);
	}));
}

export async function readWaveformSummary(
	key: string,
): Promise<SourceWaveformSummary | undefined> {
	const cached = memory.get(key);
	if (cached) {
		remember({ key, summary: cached });
		return cached;
	}
	try {
		const db = await openDatabase();
		if (!db) return;
		return await new Promise((resolve) => {
			const tx = db.transaction("summaries", "readwrite");
			const store = tx.objectStore("summaries");
			const request = store.get(key);
			request.onsuccess = () => {
				if (!validWaveformSummary(request.result)) {
					store.delete(key);
					resolve(undefined);
					return;
				}
				const summary = withWaveformLevels(request.result);
				remember({ key, summary });
				resolve(summary);
			};
			request.onerror = tx.onabort = () => resolve(undefined);
		});
	} catch {
		return undefined;
	}
}

export async function writeWaveformSummary({
	key,
	summary,
}: {
	key: string;
	summary: SourceWaveformSummary;
}): Promise<void> {
	if (
		!validWaveformSummary(summary) ||
		summaryBytes(summary) > MAX_WAVEFORM_SUMMARY_BYTES
	)
		return;
	remember({ key, summary });
	try {
		const db = await openDatabase();
		if (!db) return;
		await new Promise<void>((resolve) => {
			const tx = db.transaction("summaries", "readwrite");
			const store = tx.objectStore("summaries");
			// Levels are derived from the validated finest layer, never trusted from disk.
			store.delete(key);
			store.put({ ...summary, levels: undefined }, key);
			const keys = store.getAllKeys();
			const values = store.getAll();
			values.onsuccess = () => {
				let bytes = values.result.reduce(
					(sum: number, value: unknown) =>
						sum +
						(validWaveformSummary(value)
							? value.amplitudes.byteLength
							: MAX_WAVEFORM_STORAGE_BYTES),
					0,
				);
				let count = values.result.length;
				for (
					let i = 0;
					i < keys.result.length &&
					(count > MAX_WAVEFORM_STORAGE_COUNT ||
						bytes > MAX_WAVEFORM_STORAGE_BYTES);
					i++
				) {
					store.delete(keys.result[i]);
					count--;
					bytes -= validWaveformSummary(values.result[i])
						? values.result[i].amplitudes.byteLength
						: MAX_WAVEFORM_STORAGE_BYTES;
				}
			};
			tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
		});
	} catch {
		/* Derived data is disposable; storage must not stop playback. */
	}
}
