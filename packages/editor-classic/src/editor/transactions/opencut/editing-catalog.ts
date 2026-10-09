import { IMAGE_SEQUENCE_RESOURCE_CAPABILITY } from "@opencut/editor-contracts";
import { registerDefaultEffects } from "../../../effects/definitions";
import { effectsRegistry } from "../../../effects/registry";
import { registerDefaultGraphics } from "../../../graphics/definitions";
import { graphicsRegistry } from "../../../graphics/registry";
import { registerDefaultMasks } from "../../../masks/builtin/definitions";
import { masksRegistry } from "../../../masks/registry";
import type { ParamDefinition } from "../../../params";
import { getBuiltInElementParams } from "../../../params/registry";
import type { ElementType } from "../../../timeline/types";
import {
	DEFAULT_TRANSCRIPTION_MODEL,
	TRANSCRIPTION_MODELS,
} from "../../../transcription/models";
import { TRANSCRIPTION_LANGUAGES } from "../../../transcription/supported-languages";
import { getMvRecipeCatalog } from "./mv-recipe-catalog";

function describeParam(param: ParamDefinition) {
	const description: Record<string, unknown> = {
		key: param.key,
		label: param.label,
		type: param.type,
		default: param.default,
		keyframable: param.keyframable !== false,
		...(param.required !== undefined && { required: param.required }),
		...(param.dependencies && { dependencies: param.dependencies }),
	};
	if (param.type === "number")
		Object.assign(description, {
			min: param.min,
			max: param.max,
			step: param.step,
			displayMultiplier: param.displayMultiplier,
		});
	if (param.type === "select") description.options = param.options;
	return description;
}

/** Derived from the exact registries used by inspectors/rendering, not a second list. */
export function editingCatalog({
	htmlDocumentConfigured = false,
}: { htmlDocumentConfigured?: boolean } = {}) {
	registerDefaultEffects();
	registerDefaultGraphics();
	registerDefaultMasks();
	const types: ElementType[] = [
		"video",
		"image",
		"audio",
		"text",
		"graphic",
		"sticker",
		"motion-text",
		"effect",
	];
	return {
		version: 1,
		timebase: 120_000,
		transcription: {
			defaultModelId: DEFAULT_TRANSCRIPTION_MODEL,
			models: TRANSCRIPTION_MODELS.map((model) => ({ ...model })),
			languages: TRANSCRIPTION_LANGUAGES.map((language) => ({ ...language })),
			requiresAttachedPane: true,
			requiresModelDownloadConsent: true,
			returns: "caption-plan",
		},
		semantics: {
			programmatic: "replace-self-contained-source",
			editing: "replace",
			params: "replace",
			animations: "replace",
			effects: "ordered-replace",
			masterEffects: "update-project.patch.masterEffects; ordered-replace; [] clears; complete-scene post including backdrop; scene-timeline clock",
			masks: "ordered-replace",
			keyTime: "element-relative-ticks",
			volume: "dB",
		},
		programmatic: {
			version: 1,
			runtimes: [
				"canvas-worker",
				...(htmlDocumentConfigured ? ["html-document"] : []),
			],
			htmlDocument: {
				configured: htmlDocumentConfigured,
				availability: htmlDocumentConfigured
					? "configured-not-health-probed"
					: "unavailable",
				codeContract:
					"self-contained HTML; optional window.rocut.ready promise; renderFrame(frame) required for Canvas/JS timelines",
				documentContract:
					"inline code, or empty code + documentId selecting a text/html document resource",
				endpoint: "programmatic/frame",
				alpha: "png",
				cssAnimationTime: "quantized-source-seconds",
				cssUnsupported: [
					"pseudo-element-animation",
					"overlapping-animated-properties",
				],
				media: {
					video: "explicitly-muted-inline-mp4-webm; browser-codec-dependent",
					html: "await rocutMedia.seek(video, sourceSeconds)",
					remotion: "native-Html5Video-Video; Sequence-trim-rate-loop",
					remotionOffthread:
						"conditional-native-OffthreadVideo; probe capabilities.programmaticNativeVideo and render a frame",
					hyperframes:
						"native-video; nested-start-trim-rate-ramp-loop-tail-hold",
					audio:
						"opt-in-source.audio.native; probe capabilities.programmaticNativeAudio; final mix/encode remains Rocut",
				},
			},
			definitionId: "programmatic",
			codeContract:
				"canvas-worker: async function body (canvas, frame, assets); html-document: see htmlDocument.codeContract",
			resources: {
				manifest: "source.resources; content-addressed project attachments",
				fontAxes: "static-opentype-v1",
				kinds: [
					"image",
					"font",
					"video",
					"document",
					"analysis",
					"model",
					"environment",
					"imageSequence",
				],
				imageSequence: IMAGE_SEQUENCE_RESOURCE_CAPABILITY,
				three:
					"compiled-three-build: assets.model/texture/environment; offline self-contained GLB, PNG/JPEG, HDR/EXR; no implicit decoder downloads",
				canvas: "assets.image(id); declared fonts loaded before code executes",
				html: "window.rocutResources.ready/url/image; img/video[data-rocut-src]; video requires explicit seek",
			},
			build:
				"source.build archives original input attachments and toolchain provenance; live compiler: capabilities.programmaticBuilds",
			mvRecipe: getMvRecipeCatalog(),
			isolation:
				"fresh-worker-or-isolated-browser-per-frame; no-network-or-host-access",
			audio: {
				declaration:
					"source.audio={version:1,mode:'native',muted?,volumeDb?,profile?}",
				legacy:
					"omitted-profile: native Remotion/HyperFrames gain-only source soundtrack",
				hyperframesGraph:
					"profile:'hyperframes-graph-v1'; compile with pinned DSP archive; probe capabilities.programmaticNativeAudio.hyperframesGraph",
				identity:
					"graph PCM requires current Host runtime identity; stale/missing identity never reuses cached audio",
				fxAutomation:
					"graph-only native parameter/preset lanes; track-local and bus-global clocks; probe hyperframesGraph.fxAutomation",
				limits:
					"graph requires normalized gain envelopes and sample-aligned clip/trim/loop; participating fallback/rate automation not supported; native no-op parameters stay no-op",
			},
			unsupported: [
				"unconfigured-engine-toolchain",
				"remotion-offthread-without-native-frame-bridge",
				"undeclared-or-unconfigured-native-source-audio",
				"undeclared-network-or-file-assets",
				"unmanaged-html-video-and-audio-elements",
				"external-sub-compositions",
			],
		},
		elements: Object.fromEntries(
			types.map((type) => [
				type,
				getBuiltInElementParams({ type }).map(describeParam),
			]),
		),
		graphics: Object.fromEntries(
			graphicsRegistry
				.getAll()
				.map((definition) => [
					definition.id,
					definition.params.map(describeParam),
				]),
		),
		effects: Object.fromEntries(
			effectsRegistry
				.getAll()
				.map((definition) => [
					definition.type,
					definition.params.map(describeParam),
				]),
		),
		masks: Object.fromEntries(
			masksRegistry.getAll().map((definition) => {
				const defaults = definition.buildDefault({}).params;
				const params = definition.params
					.filter((param) => param.key !== "path")
					.map(describeParam);
				// Some canvas-only controls (inversion, stroke alignment, closed path)
				// are not inspector sliders, but are still registered default fields.
				for (const [key, value] of Object.entries(defaults)) {
					if (key === "path" || params.some((param) => param.key === key))
						continue;
					params.push(
						key === "strokeAlign"
							? {
									key,
									type: "select",
									default: value,
									options: ["inside", "center", "outside"].map((value) => ({
										value,
										label: value,
									})),
								}
							: {
									key,
									type: typeof value === "string" ? "text" : typeof value,
									default: value,
								},
					);
				}
				return [
					definition.type,
					{ params, defaults, required: Object.keys(defaults) },
				];
			}),
		),
	};
}
