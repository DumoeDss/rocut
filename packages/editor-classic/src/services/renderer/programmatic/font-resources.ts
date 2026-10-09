import type { ResolvedProgrammaticResource } from "@opencut/editor-contracts";

/** WebCrypto is unavailable inside the opaque-origin Worker. Verify an owned
 * snapshot before crossing its private port, so callers cannot mutate checked
 * font bytes while the asynchronous digest or iframe startup is in flight.
 */
export async function verifyProgrammaticFontResources({
	resources,
	signal,
}: {
	resources: readonly ResolvedProgrammaticResource[];
	signal?: AbortSignal;
}): Promise<readonly ResolvedProgrammaticResource[]> {
	signal?.throwIfAborted();
	const result: ResolvedProgrammaticResource[] = [];
	for (const resolved of resources) {
		if (resolved.resource.kind !== "font") {
			result.push(resolved);
			continue;
		}
		const resource = structuredClone(resolved.resource);
		if (
			!(resolved.body instanceof ArrayBuffer) ||
			resolved.body.byteLength !== resource.byteLength
		)
			throw Error("Font attachment length mismatch");
		const body = resolved.body.slice(0);
		const digest = [
			...new Uint8Array(await crypto.subtle.digest("SHA-256", body)),
		]
			.map((value) => value.toString(16).padStart(2, "0"))
			.join("");
		if (digest !== resource.sha256)
			throw Error("Font attachment digest mismatch");
		signal?.throwIfAborted();
		result.push({ resource, body });
	}
	return result;
}
