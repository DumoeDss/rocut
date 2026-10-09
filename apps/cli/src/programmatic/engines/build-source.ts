import * as wasm from "opencut-wasm";
import type { ProgrammaticSource, ProgrammaticResource } from "@opencut/editor-contracts";
import { describeResource } from "../resource-bytes";
import { ENGINE_VERSIONS } from "./engine-versions";

export const sourceDescription = (id: string) => ({ id, kind: "source" as const, mimeType: "application/octet-stream" });
export const DOCUMENT_ID = "_rocut/compiled.html";
export const LOCK_ID = "_rocut/toolchain-lock.json";
export function validateBuildSource(source: unknown): asserts source is ProgrammaticSource {
	const result = JSON.parse(wasm.resolveProgrammaticFrameJson(JSON.stringify({
		source, clipStart: 0, clipDuration: 1, trimStart: 0, timelineTime: 0,
	})));
	if (result.error) throw Error(result.error);
	if (!result.frame) throw Error("Expected valid active build source");
}

export function parseCompileInput(input: unknown): { sourceDirectory: string; source: ProgrammaticSource } {
	if (!input || typeof input !== "object" || Array.isArray(input)) throw Error("Expected compile specification");
	const spec = input as Record<string, unknown>;
	if (Object.keys(spec).some(key => !["version", "engine", "sourceDirectory", "entryFile", "files", "compositionId", "inputProps", "capabilities", "width", "height", "frameRate", "durationFrames", "seed", "resources", "audio"].includes(key)))
		throw Error("Unknown compile specification field");
	if (spec.version !== 1 || (spec.engine !== "hyperframes" && spec.engine !== "remotion" && spec.engine !== "three") || typeof spec.sourceDirectory !== "string"
		|| !Array.isArray(spec.files) || spec.files.some(file => typeof file !== "string")
		|| (spec.resources !== undefined && !Array.isArray(spec.resources))) throw Error("Invalid compile specification");
	const source = {
		version: 1, runtime: "html-document", code: "", documentId: DOCUMENT_ID,
		width: spec.width, height: spec.height, frameRate: spec.frameRate, durationFrames: spec.durationFrames, seed: spec.seed,
		...(spec.audio !== undefined ? { audio: spec.audio } : {}),
		resources: [describeResource({ id: DOCUMENT_ID, kind: "document", mimeType: "text/html" }, 1), ...(spec.resources as unknown[] ?? [])],
		build: {
			version: 1, engine: spec.engine, engineVersion: ENGINE_VERSIONS[spec.engine], entryFile: spec.entryFile,
			...(spec.compositionId !== undefined ? { compositionId: spec.compositionId } : {}),
			...(spec.inputProps !== undefined ? { inputProps: spec.inputProps } : {}),
			...(spec.capabilities !== undefined ? { capabilities: spec.capabilities } : {}),
			inputs: [...spec.files].sort().map(id => describeResource(sourceDescription(id), 1)),
			toolchainLock: describeResource(sourceDescription(LOCK_ID), 1),
		},
	};
	validateBuildSource(source);
	return { sourceDirectory: spec.sourceDirectory, source };
}

export function withBuildResources(source: ProgrammaticSource, inputs: readonly ProgrammaticResource[], toolchainLock: ProgrammaticResource) {
	if (!source.build) throw Error("Source has no engine archive");
	const updated = { ...source, build: { ...source.build, inputs, toolchainLock } };
	validateBuildSource(updated);
	return updated;
}
