import type {
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import type { InkFrame, InkImage, InkSong } from "./mv-ink-contract";
import { validateInkContext } from "./mv-ink-source";
export function inkResource(image: InkImage): ResolvedProgrammaticResource {
	return {
		body: image.body,
		resource: {
			id: image.id,
			kind: "image",
			mimeType: image.mimeType,
			sha256: image.sha256,
			byteLength: image.byteLength,
			attachmentKey: `programmatic-sha256-${image.sha256}`,
		},
	};
}
/** Explicit author/tick adapter; no Ink timing or drawing math. */
export function inkNativeSource({
	frame,
	song,
	resources,
}: {
	frame: InkFrame;
	song: InkSong;
	resources: readonly ResolvedProgrammaticResource[];
}): ProgrammaticSource {
	validateInkContext({ frame, song });
	const durationFrames = frame.duration * 60;
	if (!Number.isSafeInteger(durationFrames))
		throw Error("Ink requires a 60fps source grid");
	return {
		version: 1,
		runtime: "canvas-worker",
		code: "",
		width: 1920,
		height: 1080,
		frameRate: { numerator: 60, denominator: 1 },
		durationFrames,
		seed: 173,
		resources: resources.map((item) => item.resource),
		recipe: {
			version: 1,
			root: "ink",
			songStartSeconds: frame.shotStart,
			outputRoles: ["background"],
			nodes: [
				{
					id: "ink",
					scene: {
						kind: "ink",
						role: "background",
						span: { startFrame: 0, durationFrames },
						settings: {
							...frame.args,
							bpm: song.bpm,
							downbeatIndex0: song.downbeatIndex0,
							beats: {
								kind: "manual",
								songTicks: song.beats.map((time) => Math.round(time * 120000)),
							},
						},
					},
				},
			],
		},
	};
}
