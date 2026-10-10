import { isAbsolute } from "node:path";
import { THREE_LIQUID_OBJECT_PROFILE } from "../three-liquid-object-identity";
import { THREE_LIQUID_OBJECT_CAPABILITY } from "../three-liquid-object-provenance";

/** Configuration discovery is not health, GPU, installation or export proof. */
export function threeLiquidObjectCapability(options: {
	toolchainConfigured: boolean;
	executable?: string;
	connectionFile?: string;
}) {
	const configured =
		options.toolchainConfigured &&
		!!options.executable &&
		isAbsolute(options.executable) &&
		!options.connectionFile;
	return Object.freeze({
		capability: THREE_LIQUID_OBJECT_CAPABILITY,
		profile: THREE_LIQUID_OBJECT_PROFILE,
		experimental: true,
		compile: options.toolchainConfigured
			? "configured-not-health-probed"
			: "unavailable",
		capture: configured ? "configured-not-health-probed" : "unavailable",
		electron: "unavailable",
		scope: "static-model-rest-space; no-source-audio-or-offthread-video",
	});
}
