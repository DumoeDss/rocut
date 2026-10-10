import type { ProgrammaticSource } from "@opencut/editor-contracts";
import type { RemotionMetadataAdapterIdentity } from "./remotion-metadata-contract";
import { remotionMetadataJsonSha256 } from "./remotion-metadata-receipt";
import {
	validateRemotionMetadataPolicy,
	type RemotionMetadataPolicy,
	type RemotionMetadataProfile,
} from "./remotion-metadata-policy";

export const REMOTION_METADATA_MARKER = "rocut-remotion-metadata-receipt";
export function readRemotionMetadataAdapter(args: {
	lock: ArrayBuffer;
	profile: "metadata-pinned-v1";
}): RemotionMetadataAdapterIdentity;
export function readRemotionMetadataAdapter(args: {
	lock: ArrayBuffer;
	profile: RemotionMetadataProfile;
}): RemotionMetadataPolicy["adapter"];
export function readRemotionMetadataAdapter({
	lock,
	profile,
}: {
	lock: ArrayBuffer;
	profile: RemotionMetadataProfile;
}) {
	const parsed: unknown = JSON.parse(
		new TextDecoder("utf-8", { fatal: true }).decode(lock),
	);
	if (
		!parsed ||
		typeof parsed !== "object" ||
		Array.isArray(parsed) ||
		!("adapter" in parsed)
	)
		throw Error("Remotion archive has no adapter identity");
	const adapter = parsed.adapter;
	const version = profile === "metadata-pinned-v1" ? 2 : 1;
	// Validate the adapter itself through the same profile shape rules; pinned
	// binding validation is performed once its actual receipt has been recovered.
	if (
		!adapter ||
		typeof adapter !== "object" ||
		Array.isArray(adapter) ||
		!("id" in adapter) ||
		adapter.id !== "rocut-remotion-html" ||
		!("version" in adapter) ||
		adapter.version !== version ||
		!("sha256" in adapter) ||
		typeof adapter.sha256 !== "string" ||
		!/^[a-f0-9]{64}$/.test(adapter.sha256) ||
		Object.keys(adapter).sort().join(",") !== "id,sha256,version"
	)
		throw Error("Remotion archive adapter profile mismatch");
	return { id: adapter.id, version, sha256: adapter.sha256 };
}
export function remotionSourceMetadataSpec(source: ProgrammaticSource) {
	return {
		compositionId: source.build!.compositionId,
		inputProps: source.build!.inputProps ?? {},
		width: source.width,
		height: source.height,
		durationFrames: source.durationFrames,
		frameRate: source.frameRate,
	};
}
export function remotionReceiptBinding({
	source,
	adapter,
	inspectionRevision,
}: {
	source: ProgrammaticSource;
	adapter: RemotionMetadataAdapterIdentity;
	inspectionRevision: string;
}) {
	return {
		adapter,
		inspectionRevision,
		toolchainLockSha256: source.build!.toolchainLock.sha256!,
		compositionId: source.build!.compositionId!,
		inputPropsSha256: remotionMetadataJsonSha256(
			source.build!.inputProps ?? {},
		),
		width: source.width,
		height: source.height,
		durationFrames: source.durationFrames,
		frameRate: source.frameRate,
	};
}
/** The marker is content-addressed as part of the archived compiled document. */
export function readArchivedRemotionMetadataPolicy({
	source,
	lock,
	document,
}: {
	source: ProgrammaticSource;
	lock: ArrayBuffer;
	document: ArrayBuffer;
}): RemotionMetadataPolicy {
	const isRecord = (value: unknown): value is Record<string, unknown> =>
		!!value && typeof value === "object" && !Array.isArray(value);
	const parsedLock: unknown = JSON.parse(
		new TextDecoder("utf-8", { fatal: true }).decode(lock),
	);
	const profile =
		isRecord(parsedLock) &&
		isRecord(parsedLock.adapter) &&
		parsedLock.adapter.version === 2
			? "metadata-pinned-v1"
			: "legacy-unpinned";
	const adapter = readRemotionMetadataAdapter({ lock, profile });
	const html = new TextDecoder("utf-8", { fatal: true }).decode(document);
	const matches = [
		...html.matchAll(
			/<script type="application\/json" id="rocut-remotion-metadata-receipt">([^<]*)<\/script>/g,
		),
	];
	if (matches.length > 1)
		throw Error("Ambiguous Remotion archived metadata receipt");
	if (profile === "legacy-unpinned") {
		if (matches.length)
			throw Error("Remotion legacy archive contains a pinned receipt");
		return { profile, adapter };
	}
	if (matches.length !== 1)
		throw Error("Remotion pinned archive metadata receipt missing");
	const policy: unknown = JSON.parse(matches[0][1]);
	if (
		!isRecord(policy) ||
		!isRecord(policy.receipt) ||
		!policy.binding ||
		typeof policy.receipt.inspectionRevision !== "string"
	)
		throw Error("Remotion pinned archive metadata receipt missing");
	const pinnedAdapter = readRemotionMetadataAdapter({
		lock,
		profile: "metadata-pinned-v1",
	});
	const binding = remotionReceiptBinding({
		source,
		adapter: pinnedAdapter,
		inspectionRevision: policy.receipt.inspectionRevision,
	});
	if (
		remotionMetadataJsonSha256(policy.adapter) !==
		remotionMetadataJsonSha256(adapter)
	)
		throw Error("Remotion archived metadata adapter changed");
	validateRemotionMetadataPolicy({
		spec: remotionSourceMetadataSpec(source),
		policy: { ...policy, binding },
	});
	// The archived binding is also checked, not overwritten with this Host's data.
	const isValidatedPolicy = (
		value: unknown,
	): value is RemotionMetadataPolicy => {
		validateRemotionMetadataPolicy({
			spec: remotionSourceMetadataSpec(source),
			policy: value,
		});
		return true;
	};
	if (!isValidatedPolicy(policy))
		throw Error("Invalid archived Remotion policy");
	if (
		remotionMetadataJsonSha256(policy.binding) !==
		remotionMetadataJsonSha256(binding)
	)
		throw Error("Remotion archived metadata source binding changed");
	return policy;
}
