import type { BuildDraftSnapshot } from "./programmatic-build-draft";
import {
	particleDraft,
	particleFieldsDisabled,
	particleRecord,
} from "./programmatic-particle-data";

const closures: Record<
	string,
	{
		files: readonly string[];
		capability?: "particle-surface-v1" | "liquid-object-v1";
	}
> = {
	"model-feature-scene.ts": { files: ["model-feature-scene.ts"] },
	"glass-object-scene.ts": { files: ["glass-object-scene.ts"] },
	"ink-object-scene.ts": { files: ["ink-object-scene.ts"] },
	"particle-scene.ts": {
		files: ["particle-scene.ts"],
		capability: "particle-surface-v1",
	},
	"liquid-object-scene.ts": {
		files: ["liquid-object-scene.ts", "liquid-object-geometry.mjs"],
		capability: "liquid-object-v1",
	},
};
function descriptor(value: unknown, source: boolean) {
	const item = particleRecord(value);
	return (
		!!item &&
		typeof item.id === "string" &&
		!!item.id &&
		Number.isSafeInteger(item.byteLength) &&
		(item.byteLength as number) > 0 &&
		typeof item.sha256 === "string" &&
		/^[a-f0-9]{64}$/.test(item.sha256) &&
		(source
			? item.kind === "source" &&
				item.mimeType === "application/octet-stream" &&
				item.attachmentKey === `programmatic-source-sha256-${item.sha256}`
			: item.attachmentKey === `programmatic-sha256-${item.sha256}`)
	);
}
const optionalIntegers = [
	{ key: "curveSegments", label: "Curve segments (1–32)", maximum: 32 },
] as const;
export const svgShapeNumberFields = optionalIntegers;
export type SvgShapeTexts = {
	kind: string;
	depth: string;
	curveSegments: string;
};
function shapeError(shape: Record<string, unknown>) {
	const modeling = particleRecord(shape.modeling);
	if (!modeling || !["flat", "extrude"].includes(modeling.kind as string))
		return "SVG shape requires flat or extrude modeling.";
	if (
		modeling.kind === "extrude" &&
		(typeof modeling.depth !== "number" ||
			!Number.isFinite(modeling.depth) ||
			modeling.depth <= 0)
	)
		return "SVG extrusion depth must be an explicit positive finite number in viewBox units.";
	if (modeling.kind === "flat" && Object.hasOwn(modeling, "depth"))
		return "Flat SVG modeling does not accept depth.";
	for (const field of optionalIntegers)
		if (
			Object.hasOwn(shape, field.key) &&
			(!Number.isSafeInteger(shape[field.key]) ||
				(shape[field.key] as number) < 1 ||
				(shape[field.key] as number) > field.maximum)
		)
			return `${field.label}: enter an integer in the supported range.`;
	return undefined;
}

/** Only complete archived static SVG author scenes; no GLB, animation or arbitrary shader admission. */
export function svgShapeVisible(state: BuildDraftSnapshot): boolean {
	const source = state.baseline,
		build = source.build,
		props = particleRecord(build?.inputProps),
		shape = particleRecord(props?.shape);
	if (
		source.runtime !== "html-document" ||
		!build ||
		build.engine !== "three" ||
		!props ||
		props.assetKind !== "svg" ||
		!shape ||
		shapeError(shape) ||
		Object.hasOwn(props, "animation")
	)
		return false;
	const closure = closures[build.entryFile];
	if (
		!closure ||
		(closure.capability && !build.capabilities?.includes(closure.capability))
	)
		return false;
	const required = [...closure.files];
	// Older static Glass/Ink archives have a single entry. New entries archive both transport dependencies.
	if (
		["glass-object-scene.ts", "ink-object-scene.ts"].includes(
			build.entryFile,
		) &&
		build.inputs.some((i) =>
			["object-animation.mjs", "object-animation-clip-selection.mjs"].includes(
				i.id,
			),
		)
	)
		required.push(
			"object-animation.mjs",
			"object-animation-clip-selection.mjs",
		);
	if (
		!required.every((id) => {
			const matches = build.inputs.filter((i) => i.id === id);
			return matches.length === 1 && descriptor(matches[0], true);
		})
	)
		return false;
	const svg = source.resources?.filter((r) => r.id === props.modelId),
		document = source.resources?.filter((r) => r.id === source.documentId);
	return (
		svg?.length === 1 &&
		svg[0]!.kind === "model" &&
		svg[0]!.mimeType === "image/svg+xml" &&
		descriptor(svg[0], false) &&
		document?.length === 1 &&
		document[0]!.kind === "document" &&
		document[0]!.mimeType === "text/html" &&
		descriptor(document[0], false)
	);
}
export function svgShapeTexts(
	state: BuildDraftSnapshot,
): SvgShapeTexts | undefined {
	const shape = particleRecord(particleDraft(state.inputProps)?.shape),
		modeling = particleRecord(shape?.modeling);
	if (!shape || !modeling) return undefined;
	return {
		kind: typeof modeling.kind === "string" ? modeling.kind : "",
		depth: Object.hasOwn(modeling, "depth")
			? JSON.stringify(modeling.depth)
			: "",
		curveSegments: Object.hasOwn(shape, "curveSegments")
			? JSON.stringify(shape.curveSegments)
			: "",
	};
}
export function editSvgShapeDraft({
	state,
	texts,
}: {
	state: BuildDraftSnapshot;
	texts: SvgShapeTexts;
}): { inputProps?: string; error?: string } {
	if (!svgShapeVisible(state))
		return {
			error: "SVG shape controls require a complete archived static SVG scene.",
		};
	const props = particleDraft(state.inputProps),
		originalShape = particleRecord(props?.shape),
		originalModeling = particleRecord(originalShape?.modeling);
	if (!props || !originalShape || !originalModeling)
		return {
			error:
				"Fix complete Input props JSON first. Your original text is retained.",
		};
	if (props.assetKind !== "svg" || Object.hasOwn(props, "animation"))
		return {
			error: "SVG shape controls cannot edit a model or animated draft.",
		};
	const draftResources = state.baseline.resources?.filter(
		(resource) => resource.id === props.modelId,
	);
	if (
		draftResources?.length !== 1 ||
		draftResources[0]!.kind !== "model" ||
		draftResources[0]!.mimeType !== "image/svg+xml" ||
		!descriptor(draftResources[0], false)
	)
		return {
			error:
				"SVG shape requires a complete SVG resource declared in this archive.",
		};
	if (!["flat", "extrude"].includes(texts.kind))
		return {
			error: "SVG modeling: choose flat or extrude; local text is retained.",
		};
	const shape = { ...originalShape },
		modeling: Record<string, unknown> = {
			...originalModeling,
			kind: texts.kind,
		};
	if (texts.kind === "flat") delete modeling.depth;
	else {
		if (!texts.depth.trim())
			return {
				error:
					"SVG depth: enter an explicit positive value in viewBox units; no depth is generated.",
			};
		try {
			modeling.depth = JSON.parse(texts.depth);
		} catch {
			return {
				error:
					"SVG depth: enter a positive finite number; local text is retained.",
			};
		}
	}
	shape.modeling = modeling;
	for (const field of optionalIntegers) {
		const raw = texts[field.key];
		if (!raw.trim()) {
			if (Object.hasOwn(originalShape, field.key))
				return {
					error: `${field.label}: an existing value cannot be cleared; local text is retained.`,
				};
			continue;
		}
		try {
			shape[field.key] = JSON.parse(raw);
		} catch {
			return {
				error: `${field.label}: enter an integer; local text is retained.`,
			};
		}
	}
	const error = shapeError(shape);
	if (error) return { error };
	return { inputProps: JSON.stringify({ ...props, shape }, null, 2) };
}
export function changeSvgShapeText({
	state,
	canCompile,
	texts,
	key,
	next,
}: {
	state: BuildDraftSnapshot;
	canCompile: boolean;
	texts: SvgShapeTexts;
	key: keyof SvgShapeTexts;
	next: string;
}) {
	if (
		!svgShapeVisible(state) ||
		particleFieldsDisabled({ state, canCompile }) ||
		!Object.hasOwn(texts, key)
	)
		return undefined;
	const updated = { ...texts, [key]: next };
	return { texts: updated, ...editSvgShapeDraft({ state, texts: updated }) };
}
