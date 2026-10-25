import {
	createStructuredMotionTextSequence,
	MOTION_TEXT_RENDERER_SUPPORT,
	type CreateMotionTextStructuredCuesCore,
} from "@opencut/editor-classic/motion-text/factory";
import {
	integer,
	invalid,
	isStarterPreset,
	nonEmptyString,
	onlyKeys,
	record,
	rejected,
} from "./motion-text-request";

/** Pure existing Rust factory: no project, track, transaction or review mutation. */
export function prepareMotionTextCues(
	input: unknown,
	core?: CreateMotionTextStructuredCuesCore,
) {
	const request = record(input);
	onlyKeys(request, [
		"sequenceId",
		"source",
		"textSyntax",
		"cues",
		"durationTicks",
		"language",
		"starterPreset",
		"seed",
	]);
	const sequenceId = nonEmptyString(request.sequenceId, "sequenceId")!;
	const source = nonEmptyString(request.source, "source")!;
	const textSyntax = request.textSyntax;
	if (
		textSyntax !== undefined &&
		textSyntax !== "literal" &&
		textSyntax !== "jizura"
	)
		invalid("Invalid textSyntax");
	const language = nonEmptyString(request.language, "language")!;
	if (sequenceId.length > 200 || source.length > 200000 || language.length > 40)
		invalid("Motion-text input exceeds bounded text limits");
	if (
		typeof request.starterPreset !== "string" ||
		!isStarterPreset(request.starterPreset)
	)
		invalid("Invalid starterPreset");
	const starterPreset = request.starterPreset;
	const durationTicks = integer(request.durationTicks, "durationTicks", {
		minimum: 1,
	})!;
	const seed = integer(request.seed, "seed", { maximum: 0xffffffff })!;
	if (
		!Array.isArray(request.cues) ||
		request.cues.length < 1 ||
		request.cues.length > 10000
	)
		invalid("Invalid bounded cue collection");
	const cues = request.cues.map((value) => {
		const cue = record(value, "cue");
		onlyKeys(cue, ["lineId", "sourceLine", "text", "startTicks", "endTicks"]);
		const lineId = nonEmptyString(cue.lineId, "lineId")!;
		const text = nonEmptyString(cue.text, "text")!;
		if (lineId.length > 200 || text.length > 20000)
			invalid("Cue text exceeds limit");
		return {
			lineId,
			text,
			sourceLine: integer(cue.sourceLine, "sourceLine", {
				minimum: 1,
				maximum: 0xffffffff,
			})!,
			startTicks: integer(cue.startTicks, "startTicks")!,
			endTicks: integer(cue.endTicks, "endTicks")!,
		};
	});
	const built = createStructuredMotionTextSequence({
		options: {
			sequenceId,
			source,
			textSyntax,
			cues,
			durationTicks,
			language,
			starterPreset,
			seed,
			rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
		},
		core,
	});
	if (!built.sequence) rejected(built.diagnostics);
	return { sequence: built.sequence, lineMappings: built.lineMappings };
}
