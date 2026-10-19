/** Derived thumbnails live outside project persistence and can always be discarded. */
const DB_NAME = "editor-derived-video-previews-v1";
const STORE = "frames";
export const MAX_PREVIEW_PAYLOAD_BYTES = 256 * 1024;
export const MAX_PREVIEW_STORAGE_BYTES = 8 * 1024 * 1024;
let database: Promise<IDBDatabase | null> | undefined;

function openDatabase() {
	return (database ??= new Promise<IDBDatabase | null>((resolve) => {
		if (typeof indexedDB === "undefined") {
			resolve(null);
			return;
		}
		const request = indexedDB.open(DB_NAME, 1);
		request.onupgradeneeded = () => request.result.createObjectStore(STORE);
		request.onerror = () => resolve(null);
		request.onblocked = () => resolve(null);
		request.onsuccess = () => resolve(request.result);
	}));
}

export async function readPreview(key: string): Promise<string | undefined> {
	try {
		const db = await openDatabase();
		if (!db) return;
		return await new Promise<string | undefined>((resolve) => {
			const request = db.transaction(STORE).objectStore(STORE).get(key);
			request.onsuccess = () => {
				if (
					typeof request.result === "string" &&
					request.result.length * 2 <= MAX_PREVIEW_PAYLOAD_BYTES
				) {
					resolve(request.result);
				} else {
					if (request.result !== undefined) void deletePreview(key);
					resolve(undefined);
				}
			};
			request.onerror = () => resolve(undefined);
		});
	} catch {
		return undefined;
	}
}

export async function deletePreview(key: string): Promise<void> {
	try {
		const db = await openDatabase();
		if (!db) return;
		await new Promise<void>((resolve) => {
			const transaction = db.transaction(STORE, "readwrite");
			transaction.objectStore(STORE).delete(key);
			transaction.oncomplete = () => resolve();
			transaction.onerror = () => resolve();
			transaction.onabort = () => resolve();
		});
	} catch {
		/* Derived cache eviction is best effort, never a project write. */
	}
}

/** Decode only bounded, locally generated JPEG payloads, never arbitrary URLs. */
export async function validatePreview(value: string): Promise<boolean> {
	if (
		value.length * 2 > MAX_PREVIEW_PAYLOAD_BYTES ||
		!value.startsWith("data:image/jpeg;base64,") ||
		typeof Image === "undefined"
	)
		return false;
	const image = new Image();
	return await new Promise<boolean>((resolve) => {
		let settled = false;
		const finish = (valid: boolean) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			image.onload = null;
			image.onerror = null;
			image.src = "";
			resolve(valid);
		};
		const timer = setTimeout(() => finish(false), 5000);
		image.onload = () => {
			void image.decode().then(
				() =>
					finish(
						image.naturalWidth > 0 &&
							image.naturalHeight > 0 &&
							image.naturalWidth <= 240 &&
							image.naturalHeight <= 720,
					),
				() => finish(false),
			);
		};
		image.onerror = () => finish(false);
		image.src = value;
	});
}

export async function writePreview({
	key,
	value,
}: {
	key: string;
	value: string;
}): Promise<void> {
	if (value.length * 2 > MAX_PREVIEW_PAYLOAD_BYTES) return;
	try {
		const db = await openDatabase();
		if (!db) return;
		await new Promise<void>((resolve) => {
			const transaction = db.transaction(STORE, "readwrite");
			const store = transaction.objectStore(STORE);
			store.put(value, key);
			const keys = store.getAllKeys();
			const values = store.getAll();
			values.onsuccess = () => {
				let bytes = values.result.reduce(
					(total: number, item: unknown) =>
						total +
						(typeof item === "string"
							? item.length * 2
							: MAX_PREVIEW_STORAGE_BYTES),
					0,
				);
				let count = values.result.length;
				for (
					let index = 0;
					index < keys.result.length &&
					(count > 96 || bytes > MAX_PREVIEW_STORAGE_BYTES);
					index++
				) {
					store.delete(keys.result[index]);
					bytes -=
						typeof values.result[index] === "string"
							? values.result[index].length * 2
							: MAX_PREVIEW_STORAGE_BYTES;
					count--;
				}
			};
			transaction.oncomplete = () => resolve();
			transaction.onerror = () => resolve();
			transaction.onabort = () => resolve();
		});
	} catch {
		/* Storage eviction or private browsing must not prevent decoding. */
	}
}
