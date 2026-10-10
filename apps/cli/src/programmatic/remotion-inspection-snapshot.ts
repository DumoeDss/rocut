import { createHash } from "node:crypto";
import { parseCompileInput, validateBuildSource } from "./engines/build-source";
import { resourceDigest } from "./resources";
import type {
	InspectedComposition,
	PreparedRemotionCompile,
	RemotionInspectionSnapshot,
} from "./remotion-inspection-types";
import { createRemotionMetadataReceipt } from "./remotion-metadata-receipt";
import { remotionReceiptBinding } from "./remotion-metadata-archive";
import { canonicalRemotionMetadataJson } from "./remotion-metadata-json";
const isRecord = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === "object" && !Array.isArray(value);

/** Placeholder geometry only admits a source manifest; native metadata is checked
 * against Rust source policy separately before a composition can be selected. */
export function parseRemotionInspection(input: unknown) {
	if (!isRecord(input))
		throw Error("Expected Remotion inspection specification");
	const spec = input;
	if (
		Object.keys(spec).some(
			(key) =>
				![
					"version",
					"sourceDirectory",
					"entryFile",
					"files",
					"inputProps",
					"seed",
					"frameRates",
				].includes(key),
		)
	)
		throw Error("Unknown Remotion inspection field");
	const { frameRates, ...sourceSpec } = spec;
	if (frameRates !== undefined && !isRecord(frameRates))
		throw Error("Expected explicit frame rate map");
	return {
		...parseCompileInput({
			...sourceSpec,
			engine: "remotion",
			compositionId: "RocutInspection",
			width: 16,
			height: 16,
			frameRate: { numerator: 30, denominator: 1 },
			durationFrames: 1,
		}),
		frameRates,
	};
}

export function inspectionRevision(
	snapshot: Omit<RemotionInspectionSnapshot, "revision">,
): string {
	return createHash("sha256")
		.update(
			canonicalRemotionMetadataJson({
				source: snapshot.source,
				inputs: snapshot.inputs.map((input) => input.resource),
				toolchainLockSha256: snapshot.toolchainLockSha256,
				metadataAdapter: snapshot.metadataAdapter,
				compositions: snapshot.compositions,
			}),
		)
		.digest("hex");
}

function compositionSource({
	snapshot,
	composition,
	frameRate,
	checkFps = true,
}: {
	snapshot: RemotionInspectionSnapshot;
	composition: InspectedComposition;
	frameRate: unknown;
	checkFps?: boolean;
}) {
	const source = {
		...snapshot.source,
		width: composition.width,
		height: composition.height,
		durationFrames: composition.durationFrames,
		frameRate,
		build: { ...snapshot.source.build!, compositionId: composition.id },
	};
	validateBuildSource(source);
	validateBuildSource({
		...source,
		build: { ...source.build, inputProps: composition.props },
	});
	if (
		!Number.isFinite(composition.fps) ||
		composition.fps <= 0 ||
		(checkFps &&
			Math.abs(
				source.frameRate.numerator / source.frameRate.denominator -
					composition.fps,
			) > 1e-8)
	)
		throw Error("Selected frame rate differs from native composition metadata");
	return source;
}

export function admitInspectedCompositions({
	snapshot,
	frameRates,
}: {
	snapshot: RemotionInspectionSnapshot;
	frameRates?: Record<string, unknown>;
}) {
	for (const composition of snapshot.compositions) {
		const rate =
			frameRates?.[composition.id] ??
			(Number.isInteger(composition.fps)
				? { numerator: composition.fps, denominator: 1 }
				: undefined);
		// Rust validates geometry/duration/props even when the caller still needs to
		// supply an exact fractional rate. Never round or approximate native FPS.
		compositionSource({
			snapshot,
			composition,
			frameRate: rate ?? snapshot.source.frameRate,
			checkFps: rate !== undefined,
		});
		composition.admission = rate ? "accepted" : "requires-explicit-frame-rate";
	}
}

export function selectInspectedComposition({
	snapshot,
	input,
}: {
	snapshot: RemotionInspectionSnapshot | undefined;
	input: unknown;
}): PreparedRemotionCompile {
	if (!isRecord(input)) throw Error("Expected inspected composition selection");
	const spec = input;
	if (
		Object.keys(spec).some(
			(key) => !["revision", "compositionId", "frameRate"].includes(key),
		)
	)
		throw Error("Unknown inspection selection field");
	if (
		!snapshot ||
		spec.revision !== snapshot.revision ||
		inspectionRevision(snapshot) !== snapshot.revision
	)
		throw Error("Inspection revision unavailable or changed; inspect again");
	for (const item of snapshot.inputs)
		if (
			item.body.byteLength !== item.resource.byteLength ||
			resourceDigest(item.body) !== item.resource.sha256
		)
			throw Error("Inspection snapshot bytes changed; inspect again");
	const composition = snapshot.compositions.find(
		(item) => item.id === spec.compositionId,
	);
	if (!composition)
		throw Error("Composition was not present in inspected revision");
	return {
		source: compositionSource({
			snapshot,
			composition,
			frameRate: spec.frameRate,
		}),
		inputs: snapshot.inputs,
		toolchainLockSha256: snapshot.toolchainLockSha256,
		metadataReceipt: createRemotionMetadataReceipt({
			binding: {
				...remotionReceiptBinding({
					source: compositionSource({
						snapshot,
						composition,
						frameRate: spec.frameRate,
					}),
					adapter: snapshot.metadataAdapter,
					inspectionRevision: snapshot.revision,
				}),
				toolchainLockSha256: snapshot.toolchainLockSha256,
			},
			returnedProps: composition.props,
		}),
	};
}

export function assertInspectionMetadataUnchanged({
	previous,
	current,
	compositionId,
}: {
	previous: RemotionInspectionSnapshot;
	current: RemotionInspectionSnapshot;
	compositionId: string;
}) {
	const metadata = (snapshot: RemotionInspectionSnapshot) => {
		const selected = snapshot.compositions.find(
			(item) => item.id === compositionId,
		);
		if (!selected)
			throw Error("Selected composition disappeared during preflight");
		return canonicalRemotionMetadataJson({
			id: selected.id,
			width: selected.width,
			height: selected.height,
			fps: selected.fps,
			durationFrames: selected.durationFrames,
			props: selected.props,
		});
	};
	if (metadata(previous) !== metadata(current))
		throw Error("Native composition metadata/props changed; inspect again");
	if (
		canonicalRemotionMetadataJson(previous.metadataAdapter) !==
			canonicalRemotionMetadataJson(current.metadataAdapter) ||
		previous.toolchainLockSha256 !== current.toolchainLockSha256
	)
		throw Error(
			"Inspected Remotion metadata adapter/toolchain changed; inspect again",
		);
}
