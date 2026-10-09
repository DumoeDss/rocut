import type {
	ProgrammaticResource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import type { ProgrammaticFrameProvider } from "@opencut/editor-ports/host";

/** Browser boundary verifies bytes too: a transport must not substitute a new
 * resource under an unchanged source/cache key. No filesystem or direct URLs.
 */
export async function resolveCanvasResources({
	resources,
	provider,
	signal,
}: {
	resources: readonly ProgrammaticResource[];
	provider?: ProgrammaticFrameProvider;
	signal: AbortSignal;
}): Promise<ResolvedProgrammaticResource[]> {
	const result: ResolvedProgrammaticResource[] = [];
	for (const resource of resources) {
		signal.throwIfAborted();
		if (!provider?.loadResource)
			throw new Error("This host cannot load programmatic project resources");
		const blob = await provider.loadResource({ resource, signal });
		if (blob.size !== resource.byteLength || blob.type !== resource.mimeType)
			throw new Error(`Resource size/type mismatch: ${resource.id}`);
		const body = await blob.arrayBuffer();
		const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", body));
		const sha256 = Array.from(digest, (byte) =>
			byte.toString(16).padStart(2, "0"),
		).join("");
		signal.throwIfAborted();
		if (sha256 !== resource.sha256)
			throw new Error(`Resource digest mismatch: ${resource.id}`);
		result.push({ resource, body });
	}
	return result;
}
