import { createHash } from "node:crypto";
import { record } from "./motion-text-request";

/** File adapter only. Rust validates the source-domain ticks and projects against the live clip. */
export function musicAnchorFileSource(bytes: Uint8Array, resourceRevision = 1) {
	if (bytes.byteLength > 8 * 1024 ** 2)
		throw Error("Reviewed anchor file exceeds limit");
	const resource = record(
		JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
	);
	const source = record(resource.source);
	if (
		resource.schema !== "creator-music-anchors/1" ||
		resource.clock !== "source-audio-ticks" ||
		!["lyrics", "sections"].includes(String(resource.kind)) ||
		!/^[a-f0-9]{64}$/.test(String(source.sha256)) ||
		typeof resource.reviewReference !== "string" ||
		!resource.reviewReference.trim() ||
		!Array.isArray(resource.anchors) ||
		resource.anchors.length > 5000 ||
		!Number.isSafeInteger(resourceRevision) ||
		resourceRevision < 1
	)
		throw Error("Invalid reviewed anchor file");
	return {
		sourceSha256: source.sha256,
		resourceSha256: createHash("sha256").update(bytes).digest("hex"),
		resourceRevision,
		reviewReference: resource.reviewReference,
		anchors: resource.anchors.flatMap((value: unknown) => {
			const anchor = record(value);
			if (
				typeof anchor.key !== "string" ||
				!anchor.key ||
				!Number.isSafeInteger(anchor.sourceTick) ||
				Number(anchor.sourceTick) < 0 ||
				(anchor.endSourceTick !== undefined &&
					(!Number.isSafeInteger(anchor.endSourceTick) ||
						Number(anchor.endSourceTick) <= Number(anchor.sourceTick)))
			)
				throw Error("Invalid reviewed anchor point");
			return [
				{ key: `${anchor.key}:start`, sourceTick: anchor.sourceTick },
				...(anchor.endSourceTick === undefined
					? []
					: [{ key: `${anchor.key}:end`, sourceTick: anchor.endSourceTick }]),
			];
		}),
	};
}
