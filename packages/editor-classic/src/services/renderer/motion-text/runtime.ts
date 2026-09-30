import type {
	MotionTextFontAssetRef,
	MotionTextPresetGroup,
	MotionTextResolvedCut,
	MotionTextSequence,
} from "@opencut/editor-contracts";

import { resolveBgcamCamera } from "./bgcam-cameras";
import { resolveCoreShake } from "./core-screen-effects";
import { signedRandom } from "./deterministic-random";
import { resolveHorrorCamera } from "./horror-cameras";
import { resolveKineticCamera } from "./kinetic-cameras";
import { resolveLooksCamera } from "./looks-cameras";
import { STYLE_PALETTES } from "./style-palettes";
import { isMotionTextRendererPresetSupported } from "./support-manifest";
import type {
	MotionTextPalette,
	MotionTextRenderDiagnostic,
	MotionTextRenderFrame,
	MotionTextRenderRuntime,
	MotionTextResolvedFont,
} from "./types";

const TICKS_PER_SECOND = 120_000;
const DEFAULT_TRANSITION_TICKS = 36_000;

export function createMotionTextRenderRuntime({
	sequence,
	resolvedFonts = new Map(),
	resourceDiagnostics = [],
	resourceFingerprint = "unprepared",
}: {
	sequence: MotionTextSequence;
	resolvedFonts?: ReadonlyMap<string, MotionTextResolvedFont>;
	resourceDiagnostics?: readonly MotionTextRenderDiagnostic[];
	resourceFingerprint?: string;
}): MotionTextRenderRuntime {
	const diagnostics: MotionTextRenderDiagnostic[] = [...resourceDiagnostics];
	const plan = sequence.resolvedPlan;
	if (!plan || plan.sequenceRevision !== sequence.revision) {
		diagnostics.push({
			severity: "error",
			code: "invalid-plan",
			message: plan
				? "The resolved motion-text plan does not match the sequence revision."
				: "The motion-text sequence has no resolved plan.",
		});
	}
	const orderedCuts = [...(plan?.cuts ?? [])].sort((left, right) => {
		if (left.startTime !== right.startTime) {
			return left.startTime - right.startTime;
		}
		return left.id.localeCompare(right.id);
	});
	const cueColorsById = new Map(
		sequence.cues.flatMap((cue) =>
			cue.overrides.colors ? [[cue.id, cue.overrides.colors] as const] : [],
		),
	);
	return {
		sequence,
		orderedCuts,
		cueColorsById,
		baseDiagnostics: diagnostics,
		resolvedFonts,
		fingerprint: JSON.stringify({
			sequenceId: sequence.id,
			sequenceRevision: sequence.revision,
			planVersion: plan?.version ?? null,
			planRevision: plan?.sequenceRevision ?? null,
			engine: sequence.engine,
			colors: sequence.defaults.colors,
			cueColors: [...cueColorsById],
			fonts: sequence.fonts.map((font) => ({
				id: font.id,
				family: font.family,
				style: font.style,
				weight: font.weight,
				contentDigest: font.contentDigest ?? null,
			})),
			resourceFingerprint,
		}),
	};
}

export function resolveMotionTextRenderFrame({
	runtime,
	sequenceTime,
}: {
	runtime: MotionTextRenderRuntime;
	sequenceTime: number;
}): MotionTextRenderFrame | null {
	if (runtime.baseDiagnostics.some((entry) => entry.severity === "error")) {
		return null;
	}
	const { cut, index } = activeCutAt({
		cuts: runtime.orderedCuts,
		sequenceTime,
	});
	if (!cut && runtime.sequence.compositionMode === "overlay") {
		return null;
	}
	const previousCut =
		cut &&
		index > 0 &&
		runtime.orderedCuts[index - 1].startTime +
			runtime.orderedCuts[index - 1].duration ===
			cut.startTime
			? runtime.orderedCuts[index - 1]
			: null;
	const localTime = cut ? sequenceTime - cut.startTime : 0;
	const progress = cut ? clamp(localTime / cut.duration) : 0;
	const animation = cut
		? resolveAnimation({ cut, localTime })
		: EMPTY_ANIMATION;
	const fontResult = resolveFont({ runtime, cut });
	const previousFontResult = previousCut
		? resolveFont({ runtime, cut: previousCut })
		: null;
	const diagnostics = [
		...runtime.baseDiagnostics,
		...fontResult.diagnostics,
		...(previousFontResult?.diagnostics ?? []),
		...(cut ? unsupportedPresetDiagnostics(cut) : []),
		...(previousCut ? unsupportedPresetDiagnostics(previousCut) : []),
	];
	const palette = resolvePalette({ runtime, cut });
	const previousPalette = previousCut
		? resolvePalette({ runtime, cut: previousCut })
		: null;
	return {
		sequenceTime,
		cut,
		previousCut,
		localTime,
		progress,
		...animation,
		palette,
		previousPalette,
		font: fontResult.font,
		previousFont: previousFontResult?.font ?? null,
		diagnostics,
		contentFingerprint: JSON.stringify({
			runtime: runtime.fingerprint,
			sequenceTime,
			cut: cut
				? {
						id: cut.id,
						seed: cut.seed,
						preset: cut.preset,
						fontId: cut.fontId ?? null,
						parameters: cut.parameters,
					}
				: null,
			font: fontResult.font.fingerprint,
			previousFont: previousFontResult?.font.fingerprint ?? null,
			palette,
			previousPalette,
		}),
	};
}

const EMPTY_ANIMATION = {
	enterProgress: 1,
	exitProgress: 0,
	opacity: 1,
	translateX: 0,
	translateY: 0,
	scale: 1,
	scaleX: 1,
	scaleY: 1,
	skewX: 0,
	rotation: 0,
	blur: 0,
	wipe: 1,
} as const;

function activeCutAt({
	cuts,
	sequenceTime,
}: {
	cuts: readonly MotionTextResolvedCut[];
	sequenceTime: number;
}): { cut: MotionTextResolvedCut | null; index: number } {
	let low = 0;
	let high = cuts.length - 1;
	let candidate = -1;
	while (low <= high) {
		const middle = Math.floor((low + high) / 2);
		if (cuts[middle].startTime <= sequenceTime) {
			candidate = middle;
			low = middle + 1;
		} else {
			high = middle - 1;
		}
	}
	const cut = candidate >= 0 ? cuts[candidate] : undefined;
	return cut && sequenceTime < cut.startTime + cut.duration
		? { cut, index: candidate }
		: { cut: null, index: -1 };
}

function resolveAnimation({
	cut,
	localTime,
}: {
	cut: MotionTextResolvedCut;
	localTime: number;
}) {
	const transitionTicks = Math.max(
		1,
		Math.min(DEFAULT_TRANSITION_TICKS, Math.floor(cut.duration / 3)),
	);
	const enterProgress = clamp(localTime / transitionTicks);
	const exitProgress = clamp(
		(localTime - (cut.duration - transitionTicks)) / transitionTicks,
	);
	const enter = smooth(enterProgress);
	const exit = smooth(1 - exitProgress);
	let opacity = 1;
	let translateX = 0;
	let translateY = 0;
	let scale = 1;
	let scaleX = 1;
	let scaleY = 1;
	let skewX = 0;
	let rotation = 0;
	let blur = 0;
	let wipe = 1;

	switch (cut.preset.enter) {
		case "assemble":
		case "cut":
		case "drop":
		case "flicker":
		case "hrBlinkCreep":
		case "hrClawReveal":
		case "hrJumpScare":
		case "hrManifest":
		case "hrMirrorSnap":
		case "hrUneasy":
		case "hrVhold":
		case "knDiveIn":
		case "knHingeDrop":
		case "knInertia":
		case "knLoopIn":
		case "knPushIn":
		case "knReplaceIn":
		case "knStretchOut":
		case "knTypeToSlam":
		case "knWordSlam":
		case "knWordSpin":
		case "scramble":
		case "slice":
		case "spin":
		case "stretch":
		case "type":
		case "tyBracketOpen":
		case "tyDotGrow":
		case "tyKeyFirst":
		case "tyLineWipe":
		case "tyRetype":
		case "tyRubyDrop":
		case "tyUnderLift":
		case "tyZoomOne":
		case "zoom":
			break;
		case "pop":
			opacity *= enter;
			scale *= 0.62 + enter * 0.38;
			break;
		case "slideL":
			opacity *= enter;
			translateX -= (1 - enter) * 0.18;
			break;
		case "slideR":
			opacity *= enter;
			translateX += (1 - enter) * 0.18;
			break;
		case "wipe":
			wipe = enter;
			break;
		case "blur":
			blur += (1 - enter) * 18;
			opacity *= enter;
			break;
		default:
			opacity *= enter;
	}

	switch (cut.preset.exit) {
		case "backspace":
		case "blindsClose":
		case "blurOutStagger":
		case "burn":
		case "checkerOut":
		case "collapse":
		case "cut":
		case "diagWipeOut":
		case "dissolve":
		case "echoOut":
		case "explode":
		case "fall":
		case "flipOutX":
		case "flipOutY":
		case "foldOut":
		case "glitchDissolve":
		case "glitch":
		case "gravity":
		case "hrDrain":
		case "hrFlickerDie":
		case "hrLookBack":
		case "hrPulledDown":
		case "hrShiver":
		case "hrSwallow":
		case "hrTurnAway":
		case "irisClose":
		case "knCloseGap":
		case "knDiveGlyph":
		case "knJumpCutOut":
		case "knLaunch":
		case "knPushOut":
		case "knStackAway":
		case "knWordBlink":
		case "knWordKick":
		case "melt":
		case "outlineOut":
		case "popOut":
		case "riseOut":
		case "scatter":
		case "scrambleOut":
		case "shatterLite":
		case "sinkMask":
		case "slice":
		case "spinOut":
		case "splitApart":
		case "squash":
		case "sweepCover":
		case "stretch":
		case "trackOutWide":
		case "twist":
		case "undraw":
		case "vSliceDrop":
		case "waveOut":
		case "whipOut":
		case "zoomFar":
		case "zoomThrough":
		case "tyBracketClose":
		case "tyFoldVert":
		case "tyKeyLast":
		case "tyLineFeed":
		case "tyStrike":
		case "tyToDot":
		case "tyToIndex":
		case "tyUnderSink":
			break;
		case "shrink":
			opacity *= exit;
			scale *= 0.72 + exit * 0.28;
			break;
		case "slideOutL":
			opacity *= exit;
			translateX -= (1 - exit) * 0.18;
			break;
		case "slideOutR":
			opacity *= exit;
			translateX += (1 - exit) * 0.18;
			break;
		case "wipe":
			wipe = Math.min(wipe, exit);
			break;
		case "blur":
			blur += (1 - exit) * 18;
			opacity *= exit;
			break;
		case "drift":
			opacity *= exit;
			translateY -= (1 - exit) * 0.08;
			break;
		default:
			opacity *= exit;
	}

	const seconds = localTime / TICKS_PER_SECOND;
	const phase = seconds * Math.PI * 2;
	switch (cut.preset.hold) {
		case "breathe":
			scale *= 1 + Math.sin(phase * 0.5) * 0.025;
			break;
		case "pulse":
			scale *= 1 + Math.sin(phase * 1.5) * 0.035;
			break;
		case "drift":
			translateX += Math.sin(phase * 0.22) * 0.018;
			translateY += Math.cos(phase * 0.18) * 0.012;
			break;
		case "float":
			translateY += Math.sin(phase * 0.4) * 0.018;
			break;
		case "sway":
			rotation += Math.sin(phase * 0.35) * 0.018;
			break;
		case "jitter": {
			const step = Math.floor(localTime / (TICKS_PER_SECOND / 24));
			translateX += signedRandom({ seed: cut.seed, salt: step * 2 }) * 0.006;
			translateY +=
				signedRandom({ seed: cut.seed, salt: step * 2 + 1 }) * 0.006;
			break;
		}
	}
	const camera =
		resolveHorrorCamera({ cut, localTime }) ??
		resolveKineticCamera({ cut, localTime }) ??
		resolveBgcamCamera({ cut, localTime }) ??
		resolveLooksCamera({ cut, localTime });
	if (camera) {
		blur += camera.blur ?? 0;
		rotation += camera.rotation ?? 0;
		scale *= camera.scale ?? 1;
		scaleX *= camera.scaleX ?? 1;
		scaleY *= camera.scaleY ?? 1;
		skewX += camera.skewX ?? 0;
		translateX += camera.translateX ?? 0;
		translateY += camera.translateY ?? 0;
	} else if (cut.preset.cam === "push") {
		scale *= 1 + clamp(localTime / cut.duration) * 0.035;
	}
	const shake = resolveCoreShake({ cut, localTime });
	if (shake) {
		translateX += shake.translateX;
		translateY += shake.translateY;
	}

	return {
		enterProgress,
		exitProgress,
		opacity,
		translateX,
		translateY,
		scale,
		scaleX,
		scaleY,
		skewX,
		rotation,
		blur,
		wipe,
	};
}

function resolvePalette({
	runtime,
	cut,
}: {
	runtime: MotionTextRenderRuntime;
	cut: MotionTextResolvedCut | null;
}): MotionTextPalette {
	const base =
		STYLE_PALETTES[cut?.preset.style ?? "base"] ?? STYLE_PALETTES.base;
	const defaults = runtime.sequence.defaults.colors;
	const local = cut ? runtime.cueColorsById.get(cut.cueId) : undefined;
	return {
		background:
			local?.background ??
			local?.bg ??
			defaults.background ??
			defaults.bg ??
			base.background,
		foreground:
			local?.foreground ??
			local?.fg ??
			local?.text ??
			defaults.foreground ??
			defaults.fg ??
			defaults.text ??
			base.foreground,
		accent: local?.accent ?? defaults.accent ?? base.accent,
		secondary:
			local?.secondary ??
			local?.sub ??
			defaults.secondary ??
			defaults.sub ??
			base.secondary,
	};
}

function resolveFont({
	runtime,
	cut,
}: {
	runtime: MotionTextRenderRuntime;
	cut: MotionTextResolvedCut | null;
}): {
	font: MotionTextResolvedFont;
	diagnostics: MotionTextRenderDiagnostic[];
} {
	const fontId = cut?.fontId ?? runtime.sequence.defaults.fontId;
	const font = fontId
		? runtime.sequence.fonts.find((candidate) => candidate.id === fontId)
		: undefined;
	if (fontId && !font) {
		return {
			font: fallbackFont(runtime.sequence.language),
			diagnostics: [
				{
					severity: "error",
					code: "missing-font",
					message: `Motion-text cut references missing font ${fontId}.`,
				},
			],
		};
	}
	return {
		font: font
			? (runtime.resolvedFonts.get(font.id) ?? fontFromRef(font))
			: fallbackFont(runtime.sequence.language),
		diagnostics: [],
	};
}

function fontFromRef(font: MotionTextFontAssetRef): MotionTextResolvedFont {
	return {
		family: font.family,
		style: font.style,
		weight: font.weight,
		fingerprint: `${font.id}:${font.source}:${font.family}:${font.style}:${font.weight}:${font.contentDigest ?? "no-digest"}`,
	};
}

function fallbackFont(language: string): MotionTextResolvedFont {
	const family = language.startsWith("ja")
		? "Noto Sans JP"
		: language.startsWith("ko")
			? "Noto Sans KR"
			: language.startsWith("zh")
				? "Noto Sans SC"
				: "Inter";
	return {
		family,
		style: "normal",
		weight: 700,
		fingerprint: `builtin-fallback:${language}:${family}:700`,
	};
}

function unsupportedPresetDiagnostics(
	cut: MotionTextResolvedCut,
): MotionTextRenderDiagnostic[] {
	const diagnostics: MotionTextRenderDiagnostic[] = [];
	const check = ({
		group,
		id,
	}: {
		group: MotionTextPresetGroup;
		id: string;
	}) => {
		if (isMotionTextRendererPresetSupported({ group, id })) return;
		diagnostics.push({
			severity: "warning",
			code: "unsupported-preset",
			preset: `${group}:${id}`,
			message: `Motion-text renderer pack does not yet implement ${group}:${id}.`,
		});
	};
	check({ group: "style", id: cut.preset.style });
	check({ group: "layout", id: cut.preset.layout });
	check({ group: "enter", id: cut.preset.enter });
	check({ group: "hold", id: cut.preset.hold });
	check({ group: "exit", id: cut.preset.exit });
	check({ group: "treat", id: cut.preset.treat });
	check({ group: "bg", id: cut.preset.bg });
	check({ group: "cam", id: cut.preset.cam });
	for (const decor of cut.preset.decor) {
		check({ group: "decor", id: decor });
	}
	for (const fx of cut.preset.fx) {
		check({ group: "fx", id: fx });
	}
	if (cut.preset.trans) {
		check({ group: "trans", id: cut.preset.trans });
	}
	return diagnostics;
}

function clamp(value: number): number {
	return Math.min(1, Math.max(0, value));
}

function smooth(value: number): number {
	return value * value * (3 - 2 * value);
}
