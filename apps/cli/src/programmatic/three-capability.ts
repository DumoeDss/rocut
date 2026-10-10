import type { ProgrammaticSource } from "@opencut/editor-contracts";

/** Profile selection only. Rust admits the archived build before compilation. */
export function threeBuildCapability(source: ProgrammaticSource) {
	const capabilities = source.build?.capabilities;
	if (capabilities === undefined) return undefined;
	if (
		source.runtime !== "html-document" ||
		source.build?.engine !== "three" ||
		!Array.isArray(capabilities) ||
		capabilities.length !== 1 ||
		!["particle-surface-v1", "liquid-object-v1"].includes(capabilities[0])
	)
		throw Error("Invalid explicit Three capability");
	return capabilities[0];
}
