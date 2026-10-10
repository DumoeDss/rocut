import { resolveProgrammaticFrameTunnelJson } from "opencut-wasm";

/** Exercise the generated public wrapper, not a mock or only its Rust helper.
 * The companion runner checks this wrapper has no pre-admission array copy. */
export function verifyTunnelTransportBoundary(): { checks: number } {
	const oversized = new Uint8Array(64 * 1024 * 1024 + 1);
	const output: unknown = JSON.parse(
		resolveProgrammaticFrameTunnelJson("{}", "[]", oversized),
	);
	if (
		!output ||
		typeof output !== "object" ||
		!("error" in output) ||
		output.error !== "Tunnel font packet exceeds native budget" ||
		"frame" in output
	)
		throw Error("Tunnel public transport failed to reject an oversized array");
	return { checks: 1 };
}
