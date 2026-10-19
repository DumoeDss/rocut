import * as native from "opencut-wasm";

/** Feature detection, not an alternate implementation of the lock rules. */
export function trackLockValidator(): ((input: string) => string) | undefined {
	const validator: unknown = Reflect.get(native, "validateTrackLocksJson");
	if (typeof validator !== "function") return undefined;
	return (input) => {
		const result: unknown = validator(input);
		if (typeof result !== "string")
			throw new Error("Invalid native track lock validation response");
		return result;
	};
}

export function assertTrackLockRuntime(): void {
	if (!trackLockValidator())
		throw new Error(
			"Track locking requires an updated Rocut WASM runtime. Upgrade before opening or editing this locked project.",
		);
}
