import type { AssetId } from "..";
import type { MotionTextSequence } from "../motion-text";

/** Content-addressed font attachments are resources, not playable media assets. */
export function sequenceAssetIds(
	sequence: MotionTextSequence,
): readonly AssetId[] {
	return [
		sequence.audioBinding?.assetId,
		...sequence.fonts
			.filter((font) => {
				if (font.source !== "project") return false;
				const digest = /^sha256:([a-f0-9]{64})$/.exec(
					font.contentDigest ?? "",
				)?.[1];
				return !digest || font.assetId !== `programmatic-sha256-${digest}`;
			})
			.map((font) => font.assetId),
	].filter((id): id is AssetId => Boolean(id));
}
