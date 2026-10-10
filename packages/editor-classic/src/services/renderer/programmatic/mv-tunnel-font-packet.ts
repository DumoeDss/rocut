import type {
	MvTunnelFontLimits,
	ProgrammaticResource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import { verifyProgrammaticFontResources } from "./font-resources";

export interface TunnelFontPacket {
	readonly layout: string;
	readonly bytes: Uint8Array;
}
function snapshotKey(resource: ProgrammaticResource): string {
	// Rust and JS may serialize identical descriptors in different key order.
	// Arrays retain their order; every nested object field remains part of identity.
	return JSON.stringify(resource, (_key, value: unknown) =>
		value !== null && typeof value === "object" && !Array.isArray(value)
			? Object.fromEntries(
					Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
				)
			: value,
	);
}
/** Platform-only owned binary transport. Rust selects IDs, roles and budgets. */
export async function prepareTunnelFontPacket({
	requests,
	limits,
	resources,
	signal,
}: {
	requests: readonly ProgrammaticResource[];
	limits: MvTunnelFontLimits;
	resources: readonly ResolvedProgrammaticResource[];
	signal?: AbortSignal;
}): Promise<{
	packet: TunnelFontPacket;
	resources: readonly ResolvedProgrammaticResource[];
}> {
	signal?.throwIfAborted();
	const owned = await verifyProgrammaticFontResources({ resources, signal });
	const selected = requests.map((request) => {
		const found = owned.filter((r) => r.resource.id === request.id);
		if (
			found.length !== 1 ||
			snapshotKey(found[0].resource) !== snapshotKey(request)
		)
			throw Error("Tunnel font packet snapshot identity mismatch");
		return found[0];
	});
	const size = selected.reduce((sum, r) => sum + r.body.byteLength, 0);
	if (
		!Number.isSafeInteger(size) ||
		size > limits.maxBytes ||
		selected.length > limits.maxResources
	)
		throw Error("Tunnel font packet exceeds Rust limits");
	const bytes = new Uint8Array(size);
	let offset = 0;
	const entries = selected.map(({ resource, body }) => {
		const entry = { id: resource.id, offset, length: body.byteLength };
		bytes.set(new Uint8Array(body), offset);
		offset += body.byteLength;
		return entry;
	});
	const layout = JSON.stringify(entries);
	if (new TextEncoder().encode(layout).byteLength > limits.maxLayoutBytes)
		throw Error("Tunnel font layout exceeds Rust limits");
	signal?.throwIfAborted();
	return { packet: { layout, bytes }, resources: owned };
}
