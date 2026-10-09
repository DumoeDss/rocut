import type { ResolvedSequenceImage } from "@opencut/editor-contracts";
import { encodeImageSequenceImageRequest } from "@opencut/editor-contracts";
import * as wasm from "opencut-wasm";
import type { ProgrammaticFrameProvider } from "@opencut/editor-ports/host";
import type { ProgrammaticFrame } from "./frame";
import { resolveCanvasResources } from "./resources";

/** Only current-frame dependencies cross the transport. No sequence-wide body
 * listing, eager decode, prefetch or new cross-frame cache is introduced here.
 */
export async function resolveCanvasSequenceImages({
	frame,
	provider,
	signal,
}: {
	frame: ProgrammaticFrame;
	provider?: ProgrammaticFrameProvider;
	signal: AbortSignal;
}): Promise<ResolvedSequenceImage[]> {
	const result: ResolvedSequenceImage[] = [];
	const bodies = new Map<string, ArrayBuffer>();
	const admitted = new Set<string>();
	for (const selected of frame.sequenceImages ?? []) {
		signal.throwIfAborted();
		const { resource, imageKey } = selected;
		const key = JSON.stringify([
			resource.sha256,
			resource.mimeType,
			resource.byteLength,
		]);
		let body = bodies.get(key);
		if (!body) {
			const [loaded] = await resolveCanvasResources({
				resources: [resource],
				provider,
				signal,
			});
			body = loaded.body;
			bodies.set(key, body);
		}
		const geometryKey = JSON.stringify([key, selected.width, selected.height]);
		if (!admitted.has(geometryKey)) {
			if (typeof wasm.validateImageSequenceImageBytes !== "function")
				throw Error(
					"Image sequences require the matching rebuilt Rocut WASM image validator",
				);
			const checked: { width?: number; height?: number; error?: string } =
				JSON.parse(
					wasm.validateImageSequenceImageBytes(
						encodeImageSequenceImageRequest({
							body,
							mimeType: resource.mimeType,
							width: selected.width,
							height: selected.height,
						}),
					),
				);
			if (checked.error) throw Error(`Sequence image: ${checked.error}`);
			if (
				checked.width !== selected.width ||
				checked.height !== selected.height
			)
				throw Error("Invalid image sequence geometry admission response");
			admitted.add(geometryKey);
		}
		result.push({ imageKey, resource, body });
	}
	signal.throwIfAborted();
	return result;
}
