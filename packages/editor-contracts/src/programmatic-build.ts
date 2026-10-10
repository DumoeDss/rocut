import {
	isProgrammaticResource,
	type ProgrammaticResource,
} from "./programmatic-resources";

export type ProgrammaticBuildCapability =
	| "particle-surface-v1"
	| "liquid-object-v1";

/** Immutable original files and toolchain provenance. Not loaded for painting. */
export interface ProgrammaticBuild {
	readonly version: 1;
	readonly engine: "hyperframes" | "remotion" | "three";
	readonly engineVersion: string;
	readonly entryFile: string;
	readonly compositionId?: string;
	readonly inputProps?: Readonly<Record<string, unknown>>;
	readonly capabilities?: readonly ProgrammaticBuildCapability[];
	readonly inputs: readonly ProgrammaticResource[];
	readonly toolchainLock: ProgrammaticResource;
}

export function isProgrammaticBuild(
	value: unknown,
): value is ProgrammaticBuild {
	const isRecord = (input: unknown): input is Record<string, unknown> =>
		!!input && typeof input === "object" && !Array.isArray(input);
	if (!isRecord(value)) return false;
	const b = value;
	return (
		Object.keys(b).every((key) =>
			[
				"version",
				"engine",
				"engineVersion",
				"entryFile",
				"compositionId",
				"inputProps",
				"capabilities",
				"inputs",
				"toolchainLock",
			].includes(key),
		) &&
		b.version === 1 &&
		(b.engine === "hyperframes" ||
			b.engine === "remotion" ||
			b.engine === "three") &&
		typeof b.engineVersion === "string" &&
		typeof b.entryFile === "string" &&
		(b.compositionId === undefined || typeof b.compositionId === "string") &&
		(b.inputProps === undefined || isRecord(b.inputProps)) &&
		(b.capabilities === undefined ||
			(b.engine === "three" &&
				Array.isArray(b.capabilities) &&
				b.capabilities.length === 1 &&
				(b.capabilities[0] === "particle-surface-v1" ||
					b.capabilities[0] === "liquid-object-v1"))) &&
		Array.isArray(b.inputs) &&
		b.inputs.every(isProgrammaticResource) &&
		isProgrammaticResource(b.toolchainLock)
	);
}
