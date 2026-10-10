import { canonicalRemotionMetadataJson } from "./remotion-metadata-json";
import type {
	RemotionMetadataReceipt,
	RemotionMetadataValidation,
} from "./remotion-metadata-contract";

/** All runtime behavior is inside this factory; no host imports/captured policy.
 * Geometry admission remains Rust-owned; this only checks positive safe integer
 * shape and equality with the already-admitted source receipt. */
export function createRemotionMetadataValidation(
	canonical: (value: unknown) => string,
): RemotionMetadataValidation {
	const isRecord = (value: unknown): value is Record<string, unknown> =>
		!!value && typeof value === "object" && !Array.isArray(value);
	const record = (value: unknown): Record<string, unknown> => {
		canonical(value);
		if (!isRecord(value)) throw Error("Invalid Remotion metadata record");
		return value;
	};
	const exactKeys = ({
		value,
		keys,
	}: {
		value: Record<string, unknown>;
		keys: string[];
	}) => {
		if (
			Object.keys(value).length !== keys.length ||
			keys.some((key) => !Object.hasOwn(value, key))
		)
			throw Error("Unknown or missing Remotion metadata field");
	};
	const positive = (value: unknown) => {
		if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0)
			throw Error("Invalid Remotion metadata geometry/rate");
	};
	const hash = (value: unknown) => {
		if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
			throw Error("Invalid Remotion metadata identity digest");
	};
	const bindingKeys = [
		"adapter",
		"inspectionRevision",
		"toolchainLockSha256",
		"compositionId",
		"inputPropsSha256",
		"width",
		"height",
		"durationFrames",
		"frameRate",
	];
	const validateBinding = (value: Record<string, unknown>) => {
		const adapter = record(value.adapter);
		exactKeys({ value: adapter, keys: ["id", "version", "sha256"] });
		if (adapter.id !== "rocut-remotion-html" || adapter.version !== 2)
			throw Error("Unsupported Remotion metadata adapter identity");
		hash(adapter.sha256);
		for (const key of [
			"inspectionRevision",
			"toolchainLockSha256",
			"inputPropsSha256",
		])
			hash(value[key]);
		if (typeof value.compositionId !== "string" || !value.compositionId)
			throw Error("Invalid Remotion metadata composition identity");
		for (const key of ["width", "height", "durationFrames"])
			positive(value[key]);
		const rate = record(value.frameRate);
		exactKeys({ value: rate, keys: ["numerator", "denominator"] });
		positive(rate.numerator);
		positive(rate.denominator);
	};
	const validateReceipt = ({
		receipt,
		binding,
	}: {
		receipt: unknown;
		binding: unknown;
	}): RemotionMetadataReceipt => {
		const expected = record(binding),
			value = record(receipt);
		exactKeys({ value: expected, keys: bindingKeys });
		validateBinding(expected);
		const isReceipt = (
			candidate: Record<string, unknown>,
		): candidate is Record<string, unknown> & RemotionMetadataReceipt => {
			exactKeys({
				value: candidate,
				keys: [...bindingKeys, "version", "returnedProps"],
			});
			if (candidate.version !== 1)
				throw Error("Unsupported Remotion metadata receipt version");
			validateBinding(candidate);
			record(candidate.returnedProps);
			return true;
		};
		if (!isReceipt(value)) throw Error("Invalid Remotion metadata receipt");
		for (const key of bindingKeys)
			if (canonical(value[key]) !== canonical(expected[key]))
				throw Error("Remotion metadata receipt binding mismatch: " + key);
		return value;
	};
	return {
		validateReceipt,
		assertRuntimeMetadata({ receipt, binding, metadata }) {
			const pinned = validateReceipt({ receipt, binding }),
				resolved = record(metadata);
			exactKeys({
				value: resolved,
				keys: [
					"compositionId",
					"width",
					"height",
					"fps",
					"durationFrames",
					"props",
				],
			});
			for (const key of ["width", "height", "durationFrames"])
				positive(resolved[key]);
			if (
				resolved.compositionId !== pinned.compositionId ||
				resolved.width !== pinned.width ||
				resolved.height !== pinned.height ||
				resolved.durationFrames !== pinned.durationFrames ||
				typeof resolved.fps !== "number" ||
				!Number.isFinite(resolved.fps) ||
				resolved.fps <= 0 ||
				Math.abs(
					resolved.fps -
						pinned.frameRate.numerator / pinned.frameRate.denominator,
				) > 1e-8
			)
				throw Error(
					"Remotion runtime metadata geometry differs from pinned receipt",
				);
			record(resolved.props);
			if (canonical(resolved.props) !== canonical(pinned.returnedProps))
				throw Error(
					"Remotion runtime metadata props differ from pinned receipt",
				);
		},
	};
}

export const remotionMetadataValidation = createRemotionMetadataValidation(
	canonicalRemotionMetadataJson,
);
/** Assigns only a private realm helper. No execution/adapter connection yet. */
export const REMOTION_METADATA_VALIDATION_SOURCE = `const rocutCanonicalRemotionMetadataJson = (${canonicalRemotionMetadataJson.toString()});
const rocutRemotionMetadataValidation = (${createRemotionMetadataValidation.toString()})(rocutCanonicalRemotionMetadataJson);`;
