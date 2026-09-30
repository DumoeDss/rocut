import {
	isMotionTextSequence,
	type MotionTextSequence,
} from "@opencut/editor-contracts";
import * as wasm from "opencut-wasm";

export interface MotionTextIdentityReplacement {
	readonly sourceId: string;
	readonly targetId: string;
}

export interface IndependentMotionTextSequenceCopy {
	readonly sequence: MotionTextSequence;
	readonly sequenceId: MotionTextIdentityReplacement;
	readonly cueIds: readonly MotionTextIdentityReplacement[];
	readonly cutIds: readonly MotionTextIdentityReplacement[];
}

export type DuplicateMotionTextSequenceCore = (options: {
	readonly sequenceJson: string;
	readonly newSequenceId: string;
}) => unknown;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function decodeReplacement(value: unknown): MotionTextIdentityReplacement {
	if (
		!isRecord(value) ||
		typeof value.sourceId !== "string" ||
		typeof value.targetId !== "string"
	) {
		throw new TypeError(
			"Motion-text identity core returned an invalid identity replacement.",
		);
	}
	return { sourceId: value.sourceId, targetId: value.targetId };
}

function decodeReplacements(value: unknown): MotionTextIdentityReplacement[] {
	if (!Array.isArray(value)) {
		throw new TypeError(
			"Motion-text identity core returned an invalid identity map.",
		);
	}
	return value.map((entry) => decodeReplacement(entry));
}

export function duplicateIndependentMotionTextSequence({
	sequence,
	newSequenceId,
	core,
}: {
	readonly sequence: MotionTextSequence;
	readonly newSequenceId: string;
	readonly core?: DuplicateMotionTextSequenceCore;
}): IndependentMotionTextSequenceCopy {
	const candidate: unknown =
		core ?? Reflect.get(wasm, "duplicateMotionTextSequence");
	if (typeof candidate !== "function") {
		throw new Error(
			"The installed opencut-wasm binary does not expose duplicateMotionTextSequence.",
		);
	}
	const raw: unknown = candidate({
		sequenceJson: JSON.stringify(sequence),
		newSequenceId,
	});
	if (!isRecord(raw)) {
		throw new TypeError(
			"Motion-text identity core returned a non-object result.",
		);
	}
	if (raw.error !== null) {
		if (
			!isRecord(raw.error) ||
			typeof raw.error.code !== "string" ||
			typeof raw.error.message !== "string"
		) {
			throw new TypeError(
				"Motion-text identity core returned an invalid error.",
			);
		}
		throw new Error(
			`Motion-text independent copy failed (${raw.error.code}): ${raw.error.message}`,
		);
	}
	if (typeof raw.sequenceJson !== "string" || raw.sequenceId === null) {
		throw new TypeError(
			"Motion-text identity core returned an incomplete copy.",
		);
	}
	const duplicated: unknown = JSON.parse(raw.sequenceJson);
	if (!isMotionTextSequence(duplicated)) {
		throw new TypeError(
			"Motion-text identity core returned an invalid sequence.",
		);
	}
	return {
		sequence: duplicated,
		sequenceId: decodeReplacement(raw.sequenceId),
		cueIds: decodeReplacements(raw.cueIds),
		cutIds: decodeReplacements(raw.cutIds),
	};
}
