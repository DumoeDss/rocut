import type {
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import type {
	TitleRiffFont,
	TitleRiffImage,
	TitleRiffReferenceFrame,
	TitleRiffSong,
} from "./mv-title-riff-reference-contract";
import { titleRiffRequiredImages } from "./mv-title-riff-reference-input";
import { check } from "./mv-afterimage-capture";

export function titleRiffNativeResources(
	fonts: readonly TitleRiffFont[],
	images: readonly TitleRiffImage[],
): ResolvedProgrammaticResource[] {
	return [
		...fonts.map(
			({ body, id, mimeType, byteLength, sha256, family, weight }) => ({
				body,
				resource: {
					id,
					mimeType,
					byteLength,
					sha256,
					attachmentKey: `programmatic-sha256-${sha256}`,
					kind: "font" as const,
					font: { family, weight, style: "normal" as const },
				},
			}),
		),
		...images.map(({ body, id, mimeType, byteLength, sha256 }) => ({
			body,
			resource: {
				id,
				mimeType,
				byteLength,
				sha256,
				attachmentKey: `programmatic-sha256-${sha256}`,
				kind: "image" as const,
			},
		})),
	];
}

/** Explicit fixture authoring, not a production preset/default or port of draw. */
export function titleRiffNativeSource(
	frame: TitleRiffReferenceFrame,
	song: TitleRiffSong,
	resources: readonly ResolvedProgrammaticResource[],
): ProgrammaticSource {
	const face = (family: string, weight: number) => {
		const matches = resources.filter(
			({ resource }) =>
				resource.kind === "font" &&
				resource.font?.family === family &&
				resource.font.weight === weight,
		);
		check(
			matches.length === 1,
			`Missing/ambiguous actual titleRiff font ${family}/${weight}`,
		);
		return matches[0]!.resource.id;
	};
	const fonts = {
		title: face("Zen Old Mincho", 900),
		hud: face("DotGothic16", 400),
		ruby: face("Zen Kaku Gothic New", 500),
		subtitle: face("Noto Serif JP", 300),
	};
	const ids = new Set([
		...Object.values(fonts),
		...titleRiffRequiredImages(frame),
	]);
	const declared = resources.filter(({ resource }) => ids.has(resource.id));
	check(
		declared.length === ids.size,
		"Missing/duplicate native titleRiff fixture resource",
	);
	const durationFrames = frame.duration * 60;
	check(
		Number.isSafeInteger(durationFrames),
		"Fixture duration must be exactly representable at 60fps",
	);
	return {
		version: 1,
		runtime: "canvas-worker",
		code: "",
		width: 1920,
		height: 1080,
		frameRate: { numerator: 60, denominator: 1 },
		durationFrames,
		seed: 173,
		resources: declared.map(({ resource }) => resource),
		recipe: {
			version: 1,
			root: "title",
			outputRoles: ["background"],
			songStartSeconds: frame.shotStart,
			post: [],
			nodes: [
				{
					id: "title",
					scene: {
						kind: "titleRiff",
						role: "background",
						span: { startFrame: 0, durationFrames },
						settings: {
							...frame.args,
							fonts,
							beats: {
								kind: "manual",
								songTicks: song.beats.map((time) => Math.round(time * 120000)),
							},
							bpm: song.bpm,
							downbeatIndex0: song.downbeatIndex0,
							credit: song.credit,
						},
					},
				},
			],
		},
	};
}

/** Compute oracle seconds from the native frame grid, not the requested decimal. */
export function titleRiffNativeSample(
	frame: TitleRiffReferenceFrame,
	index: number,
): TitleRiffReferenceFrame {
	check(
		Number.isSafeInteger(index) && index >= 0 && index < frame.duration * 60,
		"Invalid native titleRiff fixture index",
	);
	return {
		...frame,
		time: (Math.round(frame.shotStart * 120000) + index * 2000) / 120000,
	};
}
