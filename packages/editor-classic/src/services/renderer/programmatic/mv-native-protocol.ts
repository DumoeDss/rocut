import type { MvNativeRasterInput } from "./mv-native-admission";

/** Private one-shot transport, never an authored source/runtime contract. */
export const MV_NATIVE_CONNECT = "rocut-mv-native-connect-v1";
export const MV_NATIVE_PROTOCOL = "rocut-mv-native-v1";

export interface MvNativeRequest {
	readonly protocol: typeof MV_NATIVE_PROTOCOL;
	readonly requestId: string;
	readonly type: "render";
	readonly input: MvNativeRasterInput;
}

export interface MvNativeDispose {
	readonly protocol: typeof MV_NATIVE_PROTOCOL;
	readonly requestId: string;
	readonly type: "dispose";
}

export function isMvNativeEnvelope(
	value: unknown,
	requestId: string,
): value is { protocol: string; requestId: string; type: string } {
	return (
		!!value &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		Reflect.get(value, "protocol") === MV_NATIVE_PROTOCOL &&
		Reflect.get(value, "requestId") === requestId &&
		["ready", "rendered", "error", "disposed"].includes(
			Reflect.get(value, "type"),
		)
	);
}
