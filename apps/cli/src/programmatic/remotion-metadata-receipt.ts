import { createHash } from "node:crypto";
import { canonicalRemotionMetadataJson } from "./remotion-metadata-json";
import { remotionMetadataValidation } from "./remotion-metadata-validation";
import type {
	RemotionMetadataBinding,
	RemotionMetadataReceipt,
} from "./remotion-metadata-contract";

export function remotionMetadataJsonSha256(value: unknown): string {
	return createHash("sha256")
		.update(canonicalRemotionMetadataJson(value), "utf8")
		.digest("hex");
}

/** Detached JSON snapshots prevent later caller mutation of the authored result.
 * This creates no trustworthy identity by itself: the integration must supply
 * authenticated inspection/source/toolchain bindings, not caller receipts. */
export function createRemotionMetadataReceipt({
	binding,
	returnedProps,
}: {
	binding: RemotionMetadataBinding;
	returnedProps: unknown;
}): RemotionMetadataReceipt {
	canonicalRemotionMetadataJson(binding);
	const receipt: unknown = JSON.parse(
		canonicalRemotionMetadataJson({ ...binding, version: 1, returnedProps }),
	);
	return remotionMetadataValidation.validateReceipt({ receipt, binding });
}
