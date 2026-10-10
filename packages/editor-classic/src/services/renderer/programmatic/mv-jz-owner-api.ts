export interface JzNativeOwner {
	prepare(metadata: string, bytes: Uint8Array): number;
	preparedJson(session: number): string;
	frame(session: number, request: string): string;
	checkText(session: number, fontId: string, text: string): void;
	finishFrame(session: number, serial: number): void;
	release(session: number): void;
	dispose(): void;
	free(): void;
}

/** A stale WASM constructor may allocate an owner while exposing the old API.
 * Reject it without losing the destructor, before any session or FontFace IO. */
export function createJzNativeOwner(factory: unknown): JzNativeOwner {
	if (typeof factory !== "function")
		throw Error("JIZURA requires rebuilt native WASM owner");
	const value: unknown = Reflect.construct(factory, []);
	if (
		value && typeof value === "object" &&
		["prepare", "preparedJson", "frame", "checkText", "finishFrame", "release", "dispose", "free"].every(
			method => typeof Reflect.get(value, method) === "function",
		)
	) return value as JzNativeOwner;
	if (value && typeof value === "object") {
		try {
			try {
				const dispose = Reflect.get(value, "dispose");
				if (typeof dispose === "function") Reflect.apply(dispose, value, []);
			} finally {
				const free = Reflect.get(value, "free");
				if (typeof free === "function") Reflect.apply(free, value, []);
			}
		} catch {
			// Preserve the rebuild diagnostic even if an incompatible destructor
			// fails. The independent WASM free attempt above must still happen.
		}
	}
	throw Error("Invalid JIZURA WASM owner API; rebuild the native owner");
}
