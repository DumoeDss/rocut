import * as wasm from "opencut-wasm";
import { describeResource } from "./resource-bytes";

type Admission = "accepted" | "rejected" | "not-probed";
export type ProgrammaticResourceValidationProbe = (json: string) => string;

// Candidates, not an allowlist. Only the installed Rust validator determines
// descriptor admission; e.g. older WASM may reject SVG despite new JS metadata.
const MODEL_MIME_CANDIDATES = [
	"model/gltf-binary",
	"image/svg+xml",
	"model/gltf+json",
	"image/ktx2",
	"image/png",
] as const;

export function modelInputCapability(
	validate:
		| ProgrammaticResourceValidationProbe
		| undefined = wasm.validateProgrammaticResourcesJson,
) {
	const probe = (mimeType: string): Admission => {
		if (typeof validate !== "function") return "not-probed";
		try {
			const descriptor = describeResource(
				{ id: "model-input-probe", kind: "model", mimeType },
				1,
			);
			const issues: unknown = JSON.parse(
				validate(JSON.stringify([descriptor])),
			);
			if (
				!Array.isArray(issues) ||
				issues.some(
					(issue) =>
						!issue ||
						typeof issue !== "object" ||
						Array.isArray(issue) ||
						typeof issue.message !== "string" ||
						typeof issue.path !== "string",
				)
			)
				return "not-probed";
			return issues.length ? "rejected" : "accepted";
		} catch {
			// API absence, traps and malformed transport are not MIME rejection.
			return "not-probed";
		}
	};
	return {
		version: 1,
		kind: "model",
		probe: "rust-resource-descriptor-admission-v1",
		validator: "validateProgrammaticResourcesJson",
		scope: "descriptor-only; no-file-io-or-decoder-gpu-health",
		archiveScope: "separate-modelArchive-source-import; not-probed",
		mimeTypes: MODEL_MIME_CANDIDATES.map((mimeType) => ({
			mimeType,
			admission: probe(mimeType),
		})),
	};
}
