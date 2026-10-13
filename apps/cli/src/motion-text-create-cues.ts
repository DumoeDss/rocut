import { createHash } from "node:crypto";
import type { AutomationApi } from "@opencut/editor-automation";
import {
	clipId,
	mediaTime,
	revisionOf,
	trackId,
	type TransactionOperation,
} from "@opencut/editor-contracts";
import {
	createStructuredMotionTextSequence,
	hasStructuredMotionTextCore,
	MOTION_TEXT_RENDERER_SUPPORT,
	type CreateMotionTextStructuredCuesCore,
	type StructuredMotionTextCue,
} from "@opencut/editor-classic/motion-text/factory";
import {
	integer,
	invalid,
	isStarterPreset,
	nonEmptyString,
	onlyKeys,
	record,
	rejected,
	stableId,
} from "./motion-text-request";

function canonical(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	const input = value as Record<string, unknown>;
	return `{${Object.keys(input)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${canonical(input[key])}`)
		.join(",")}}`;
}

export function structuredCuesCapability(
	core?: CreateMotionTextStructuredCuesCore,
) {
	return {
		route: "motion-text/create-cues",
		preview: true,
		preservesText: true,
		ticksPerSecond: 120000,
		coordinate: "sequence-local-ticks",
		available: hasStructuredMotionTextCore(core),
	};
}

export async function createMotionTextCues(args: {
	readonly automation: AutomationApi;
	readonly input: unknown;
	readonly preview?: boolean;
	readonly core?: CreateMotionTextStructuredCuesCore;
}): Promise<Readonly<Record<string, unknown>>> {
	const input = record(args.input);
	onlyKeys(input, [
		"expectedRevision",
		"idempotencyKey",
		"trackId",
		"timelineStartTicks",
		"durationTicks",
		"language",
		"starterPreset",
		"seed",
		"source",
		"cues",
		"candidateHash",
	]);
	const expectedRevision = integer(input.expectedRevision, "expectedRevision")!;
	const idempotencyKey = nonEmptyString(
		input.idempotencyKey,
		"idempotencyKey",
	)!;
	const targetTrack = nonEmptyString(input.trackId, "trackId")!;
	const timelineStartTicks = integer(
		input.timelineStartTicks,
		"timelineStartTicks",
	)!;
	const durationTicks = integer(input.durationTicks, "durationTicks", {
		minimum: 1,
	})!;
	if (!Number.isSafeInteger(timelineStartTicks + durationTicks))
		invalid("Clip endpoint exceeds safe integer ticks");
	const language = nonEmptyString(input.language, "language")!;
	const source = nonEmptyString(input.source, "source")!;
	if (
		typeof input.starterPreset !== "string" ||
		!isStarterPreset(input.starterPreset)
	)
		invalid("Invalid starterPreset");
	const starterPreset = input.starterPreset;
	const seed = integer(input.seed, "seed", {
		optional: true,
		maximum: 0xffff_ffff,
	});
	if (!Array.isArray(input.cues)) invalid("cues must be an array");
	const cues: StructuredMotionTextCue[] = input.cues.map((value) => {
		const cue = record(value, "cue");
		onlyKeys(cue, ["lineId", "sourceLine", "text", "startTicks", "endTicks"]);
		if (typeof cue.lineId !== "string" || typeof cue.text !== "string")
			invalid("Cue lineId and text must be strings");
		return {
			lineId: cue.lineId,
			text: cue.text,
			sourceLine: integer(cue.sourceLine, "sourceLine", {
				minimum: 1,
				maximum: 0xffff_ffff,
			})!,
			startTicks: integer(cue.startTicks, "startTicks")!,
			endTicks: integer(cue.endTicks, "endTicks")!,
		};
	});
	if (
		!args.preview &&
		(typeof input.candidateHash !== "string" ||
			!/^[a-f0-9]{64}$/.test(input.candidateHash))
	)
		invalid("Apply requires the reviewed candidateHash");
	if (!hasStructuredMotionTextCore(args.core))
		invalid("Structured motion-text capability is unavailable");
	const baseRevision = Number(await args.automation.revision());
	if (args.preview && baseRevision !== expectedRevision)
		invalid("Preview expectedRevision differs from current project revision");
	const tracks = await args.automation.tracks();
	const selectedTrack = tracks.find(
		(entry) => entry.id === targetTrack && entry.kind === "graphic",
	);
	if (!selectedTrack) invalid("Existing graphic track required");
	const project = await args.automation.project();
	if (!project || project.id !== args.automation.projectId)
		invalid("Native project identity is unavailable");
	const nativeScope = {
		projectId: project.id,
		sceneId: selectedTrack.sceneId ?? null,
		baseRevision: expectedRevision,
		track: selectedTrack,
	};
	const sequenceId = stableId("sequence", `structured-cues:${idempotencyKey}`);
	const clipIdValue = stableId("clip", `structured-cues:${idempotencyKey}`);
	const built = createStructuredMotionTextSequence({
		options: {
			sequenceId,
			source,
			cues,
			language,
			durationTicks,
			starterPreset,
			...(seed === undefined ? {} : { seed }),
			rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
		},
		core: args.core,
	});
	if (built.sequence === null) rejected(built.diagnostics);
	const operations: TransactionOperation[] = [
		{ kind: "create-motion-text-sequence", sequence: built.sequence },
		{
			kind: "create-clip",
			clip: {
				id: clipId(clipIdValue),
				trackId: trackId(targetTrack),
				startTime: mediaTime({ ticks: timelineStartTicks }),
				duration: built.sequence.duration,
				trimStart: mediaTime({ ticks: 0 }),
				trimEnd: mediaTime({ ticks: 0 }),
				content: { kind: "motion-text", sequenceId: built.sequence.id },
			},
		},
	];
	const fixedInput = {
		expectedRevision,
		idempotencyKey,
		trackId: targetTrack,
		timelineStartTicks,
		durationTicks,
		language,
		starterPreset,
		...(seed === undefined ? {} : { seed }),
		source,
		cues,
	};
	const candidateHash = createHash("sha256")
		.update(
			canonical({
				format: "motion-text-structured-cues/1",
				nativeScope,
				input: fixedInput,
				operations,
				lineMappings: built.lineMappings,
			}),
		)
		.digest("hex");
	if (
		input.candidateHash !== undefined &&
		input.candidateHash !== candidateHash
	)
		invalid("Reviewed structured-cues candidate differs");
	const preview = {
		baseRevision,
		projectId: project.id,
		sceneId: selectedTrack.sceneId ?? null,
		sequenceId,
		clipId: clipIdValue,
		trackId: targetTrack,
		lineMappings: built.lineMappings,
		cues: built.sequence.cues,
		diagnostics: built.diagnostics,
		candidateHash,
	};
	if (args.preview) {
		const admission = await args.automation.engine.dryRun({
			operations,
			expectedRevision: revisionOf(expectedRevision),
			idempotencyKey,
		});
		if (!admission.accepted) rejected(admission.issues);
		return { ...preview, sequence: built.sequence, applied: false };
	}
	const applied = await args.automation.apply({
		operations,
		expectedRevision: revisionOf(expectedRevision),
		idempotencyKey,
	});
	return {
		...preview,
		applied: true,
		projectRevision: Number(applied.revision),
		sequenceRevision: built.sequence.revision,
		createdIds: applied.createdIds,
		changedIds: applied.changedIds,
	};
}
