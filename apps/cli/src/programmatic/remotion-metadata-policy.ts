import { canonicalRemotionMetadataJson } from "./remotion-metadata-json";
import {
	remotionMetadataValidation,
	REMOTION_METADATA_VALIDATION_SOURCE,
} from "./remotion-metadata-validation";
import type {
	RemotionMetadataBinding,
	RemotionMetadataReceipt,
	RemotionMetadataValidation,
	RemotionResolvedMetadata,
} from "./remotion-metadata-contract";

export type RemotionMetadataProfile = "legacy-unpinned" | "metadata-pinned-v1";
export interface RemotionMetadataPolicy {
	profile: RemotionMetadataProfile;
	adapter: { id: "rocut-remotion-html"; version: 1 | 2; sha256: string };
	binding?: RemotionMetadataBinding;
	receipt?: RemotionMetadataReceipt;
}

/** Called by the compiler's pre-author globals script. Keeps immutable authority
 * in a closure; deleting receipt cannot turn a v2 compiled archive into legacy. */
export function createRemotionMetadataPolicy({
	spec,
	policy,
	canonical,
	validation,
}: {
	spec: unknown;
	policy: unknown;
	canonical: (value: unknown) => string;
	validation: RemotionMetadataValidation;
}) {
	canonical(spec);
	canonical(policy);
	const isRecord = (value: unknown): value is Record<string, unknown> =>
		!!value && typeof value === "object" && !Array.isArray(value);
	if (!isRecord(spec) || !isRecord(policy))
		throw Error("Invalid Remotion compiled metadata policy");
	const source = spec,
		pinned = policy;
	const freeze = (value: unknown): void => {
		if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
		for (const child of Object.values(value)) freeze(child);
		Object.freeze(value);
	};
	freeze(source);
	freeze(pinned);
	const adapter = pinned.adapter;
	if (
		!isRecord(adapter) ||
		adapter.id !== "rocut-remotion-html" ||
		typeof adapter.sha256 !== "string" ||
		!/^[a-f0-9]{64}$/.test(adapter.sha256) ||
		Object.keys(adapter).sort().join(",") !== "id,sha256,version"
	)
		throw Error("Invalid Remotion compiled adapter identity");
	if (pinned.profile === "legacy-unpinned") {
		if (
			adapter.version !== 1 ||
			Object.keys(pinned).sort().join(",") !== "adapter,profile"
		)
			throw Error("Remotion compiled metadata profile/adapter mismatch");
		return Object.freeze({
			profile: "legacy-unpinned" as const,
			spec: source,
			assertInputProps() {},
			assertMetadata() {},
		});
	}
	if (
		pinned.profile !== "metadata-pinned-v1" ||
		adapter.version !== 2 ||
		Object.keys(pinned).sort().join(",") !== "adapter,binding,profile,receipt"
	)
		throw Error("Remotion pinned metadata receipt missing or unsupported");
	const receipt = validation.validateReceipt({
		receipt: pinned.receipt,
		binding: pinned.binding,
	});
	if (canonical(receipt.adapter) !== canonical(adapter))
		throw Error("Remotion compiled adapter differs from pinned receipt");
	for (const key of [
		"compositionId",
		"width",
		"height",
		"durationFrames",
		"frameRate",
	] as const)
		if (canonical(source[key]) !== canonical(receipt[key]))
			throw Error(
				"Remotion compiled source differs from pinned receipt: " + key,
			);
	const expectedInputProps = canonical(source.inputProps ?? {});
	return Object.freeze({
		profile: "metadata-pinned-v1" as const,
		spec: source,
		assertInputProps(inputProps: unknown) {
			if (canonical(inputProps) !== expectedInputProps)
				throw Error("Remotion runtime input props differ from pinned receipt");
		},
		assertMetadata(metadata: RemotionResolvedMetadata) {
			validation.assertRuntimeMetadata({
				receipt,
				binding: pinned.binding,
				metadata,
			});
		},
	});
}

export function validateRemotionMetadataPolicy({
	spec,
	policy,
}: {
	spec: unknown;
	policy: unknown;
}) {
	return createRemotionMetadataPolicy({
		spec,
		policy,
		canonical: canonicalRemotionMetadataJson,
		validation: remotionMetadataValidation,
	});
}
export const REMOTION_METADATA_POLICY_SOURCE = `${REMOTION_METADATA_VALIDATION_SOURCE}
const rocutCreateRemotionMetadataPolicy = (${createRemotionMetadataPolicy.toString()});`;
