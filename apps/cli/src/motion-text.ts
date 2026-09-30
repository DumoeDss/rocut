/**
 * High-level motion-text automation for the CLI host.
 *
 * Callers provide source text or a domain mutation. Only the Rust/WASM
 * factory may create or replace a resolved sequence; callers never submit a
 * resolved plan through this surface.
 */
import type { AutomationApi } from "@opencut/editor-automation";
import {
	clipId,
	mediaTime,
	revisionOf,
	trackId,
	type MotionTextPresetGroup,
	type MotionTextSequence,
	type TransactionOperation,
} from "@opencut/editor-contracts";
import {
	createMotionTextVariationCandidate,
	createStarterMotionTextSequence,
	importJizuraMotionTextProject,
	MOTION_TEXT_RENDERER_SUPPORT,
	MOTION_TEXT_STARTER_PRESET_IDS,
	mutateMotionTextSequence,
	type CreateMotionTextSequenceCore,
	type CreateMotionTextVariationCandidateCore,
	type ImportJizuraMotionTextProjectCore,
	type MutateMotionTextSequenceCore,
} from "@opencut/editor-classic/motion-text/factory";
import {
	integer,
	invalid,
	isStarterPreset,
	motionTextCatalog,
	MotionTextApiError,
	mutationFrom,
	nonEmptyString,
	onlyKeys,
	PRESET_GROUPS,
	record,
	rejected,
	rememberMotionTextRequest,
	replayMotionTextRequest,
	stableId,
	stringArray,
	type MotionTextRequestJournal,
} from "./motion-text-request";

export {
	createMotionTextRequestJournal,
	MotionTextApiError,
	motionTextCatalog,
	type MotionTextRequestJournal,
} from "./motion-text-request";

export interface MotionTextFactoryCores {
	readonly create?: CreateMotionTextSequenceCore;
	readonly importJizura?: ImportJizuraMotionTextProjectCore;
	readonly mutate?: MutateMotionTextSequenceCore;
	readonly variation?: CreateMotionTextVariationCandidateCore;
}

function sequenceById(
	sequences: readonly MotionTextSequence[],
	sequenceIdValue: string,
): MotionTextSequence {
	const sequence = sequences.find((entry) => entry.id === sequenceIdValue);
	if (sequence === undefined) {
		throw new MotionTextApiError({
			status: 404,
			code: "motion-text-sequence-not-found",
			message: `Motion-text sequence ${sequenceIdValue} was not found.`,
			details: { sequenceId: sequenceIdValue },
		});
	}
	return sequence;
}

function assertSequenceRevision(
	sequence: MotionTextSequence,
	expectedSequenceRevision: number,
): void {
	if (sequence.revision === expectedSequenceRevision) return;
	throw new MotionTextApiError({
		status: 409,
		code: "motion-text-sequence-conflict",
		message: `Expected motion-text sequence revision ${expectedSequenceRevision}, but found ${sequence.revision}.`,
		details: {
			sequenceId: sequence.id,
			expectedSequenceRevision,
			actualSequenceRevision: sequence.revision,
		},
	});
}

function changedEntityIds<T extends { readonly id: string }>(
	before: readonly T[],
	after: readonly T[],
): string[] {
	const left = new Map(
		before.map((entry) => [entry.id, JSON.stringify(entry)]),
	);
	const right = new Map(
		after.map((entry) => [entry.id, JSON.stringify(entry)]),
	);
	return [...new Set([...left.keys(), ...right.keys()])].filter(
		(id) => left.get(id) !== right.get(id),
	);
}

function affected(before: MotionTextSequence, after: MotionTextSequence) {
	return {
		sequenceId: after.id,
		cueIds: changedEntityIds(before.cues, after.cues),
		cutIds: changedEntityIds(
			before.resolvedPlan?.cuts ?? [],
			after.resolvedPlan?.cuts ?? [],
		),
	};
}

const CREATE_COMMON_KEYS = [
	"source",
	"sourceFormat",
	"startTime",
	"trackId",
	"trackName",
	"expectedRevision",
	"idempotencyKey",
] as const;

export async function createMotionText(args: {
	readonly automation: AutomationApi;
	readonly input: unknown;
	readonly cores?: MotionTextFactoryCores;
	readonly journal?: MotionTextRequestJournal;
}): Promise<Readonly<Record<string, unknown>>> {
	const input = record(args.input);
	const source = nonEmptyString(input.source, "source")!;
	const sourceFormat = input.sourceFormat ?? "plain";
	if (
		sourceFormat !== "plain" &&
		sourceFormat !== "lrc" &&
		sourceFormat !== "jizura"
	) {
		return invalid("sourceFormat must be plain, lrc, or jizura.", {
			field: "sourceFormat",
		});
	}
	const formatKeys =
		sourceFormat === "jizura"
			? CREATE_COMMON_KEYS
			: [
					...CREATE_COMMON_KEYS,
					"language",
					"duration",
					"starterPreset",
					"seed",
				];
	onlyKeys(input, formatKeys);
	const expectedRevision = integer(input.expectedRevision, "expectedRevision")!;
	const idempotencyKey = nonEmptyString(
		input.idempotencyKey,
		"idempotencyKey",
	)!;
	const replayed = replayMotionTextRequest({
		journal: args.journal,
		idempotencyKey,
		scope: "create",
		input,
	});
	if (replayed !== null) return replayed;
	const startTime = integer(input.startTime ?? 0, "startTime")!;
	const requestedTrackId = nonEmptyString(input.trackId, "trackId", {
		optional: true,
	});
	const trackName =
		nonEmptyString(input.trackName, "trackName", { optional: true }) ??
		"Motion text";
	const sequenceIdValue = stableId("sequence", idempotencyKey);
	const clipIdValue = stableId("clip", idempotencyKey);

	let built:
		| ReturnType<typeof createStarterMotionTextSequence>
		| ReturnType<typeof importJizuraMotionTextProject>;
	let importDetails: Readonly<Record<string, unknown>> = {};
	if (sourceFormat === "jizura") {
		const imported = importJizuraMotionTextProject({
			sequenceId: sequenceIdValue,
			projectJson: source,
			rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
			...(args.cores?.importJizura === undefined
				? {}
				: { core: args.cores.importJizura }),
		});
		built = imported;
		importDetails = {
			resourcesNeeded: imported.resourcesNeeded,
			compatibilityReport: imported.compatibilityReport,
		};
	} else {
		const duration = integer(input.duration, "duration", { minimum: 1 })!;
		const seed = integer(input.seed, "seed", {
			optional: true,
			maximum: 0xffff_ffff,
		});
		const starterPreset = input.starterPreset ?? "clean-caption";
		if (typeof starterPreset !== "string" || !isStarterPreset(starterPreset)) {
			return invalid("starterPreset is not a supported starter preset.", {
				field: "starterPreset",
				supported: MOTION_TEXT_STARTER_PRESET_IDS,
			});
		}
		built = createStarterMotionTextSequence({
			sequenceId: sequenceIdValue,
			source,
			sourceFormat,
			language:
				nonEmptyString(input.language, "language", { optional: true }) ??
				"zh-Hans",
			duration,
			...(seed === undefined ? {} : { seed }),
			starterPreset,
			rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
			...(args.cores?.create === undefined ? {} : { core: args.cores.create }),
		});
	}
	if (built.sequence === null) rejected(built.diagnostics);
	const sequence = built.sequence;
	const tracks = await args.automation.tracks();
	const operations: TransactionOperation[] = [];
	let targetTrackId: ReturnType<typeof trackId>;
	if (requestedTrackId === undefined) {
		targetTrackId = trackId(stableId("track", idempotencyKey));
		operations.push({
			kind: "create-track",
			track: {
				id: targetTrackId,
				kind: "graphic",
				name: trackName,
				hidden: false,
			},
		});
	} else {
		targetTrackId = trackId(requestedTrackId);
		const track = tracks.find((entry) => entry.id === targetTrackId);
		if (track === undefined) {
			throw new MotionTextApiError({
				status: 404,
				code: "motion-text-track-not-found",
				message: `Track ${requestedTrackId} was not found.`,
				details: { trackId: requestedTrackId },
			});
		}
		if (track.kind !== "graphic") {
			invalid("Motion-text clips require a graphic track.", {
				trackId: requestedTrackId,
				trackKind: track.kind,
			});
		}
	}
	operations.push(
		{ kind: "create-motion-text-sequence", sequence },
		{
			kind: "create-clip",
			clip: {
				id: clipId(clipIdValue),
				trackId: targetTrackId,
				startTime: mediaTime({ ticks: startTime }),
				duration: sequence.duration,
				trimStart: mediaTime({ ticks: 0 }),
				trimEnd: mediaTime({ ticks: 0 }),
				content: { kind: "motion-text", sequenceId: sequence.id },
			},
		},
	);
	const result = await args.automation.apply({
		operations,
		expectedRevision: revisionOf(expectedRevision),
		idempotencyKey,
	});
	const response = {
		accepted: true,
		operation: "create",
		projectRevision: Number(result.revision),
		sequenceRevision: sequence.revision,
		sequenceId: sequence.id,
		clipId: clipIdValue,
		trackId: targetTrackId,
		createdIds: result.createdIds,
		changedIds: result.changedIds,
		affected: {
			sequenceId: sequence.id,
			cueIds: sequence.cues.map((cue) => cue.id),
			cutIds: sequence.resolvedPlan?.cuts.map((cut) => cut.id) ?? [],
		},
		diagnostics: built.diagnostics,
		...importDetails,
	};
	rememberMotionTextRequest({
		journal: args.journal,
		idempotencyKey,
		scope: "create",
		input,
		response,
	});
	return response;
}

export async function mutateMotionText(args: {
	readonly automation: AutomationApi;
	readonly sequenceId: string;
	readonly input: unknown;
	readonly cores?: MotionTextFactoryCores;
	readonly journal?: MotionTextRequestJournal;
}): Promise<Readonly<Record<string, unknown>>> {
	const input = record(args.input);
	onlyKeys(input, [
		"mutation",
		"expectedRevision",
		"expectedSequenceRevision",
		"idempotencyKey",
	]);
	const expectedRevision = integer(input.expectedRevision, "expectedRevision")!;
	const expectedSequenceRevision = integer(
		input.expectedSequenceRevision,
		"expectedSequenceRevision",
	)!;
	const idempotencyKey = nonEmptyString(
		input.idempotencyKey,
		"idempotencyKey",
	)!;
	const scope = `mutate:${args.sequenceId}`;
	const replayed = replayMotionTextRequest({
		journal: args.journal,
		idempotencyKey,
		scope,
		input,
	});
	if (replayed !== null) return replayed;
	const sequences = (await args.automation.motionTextSequences?.()) ?? [];
	const sequence = sequenceById(sequences, args.sequenceId);
	assertSequenceRevision(sequence, expectedSequenceRevision);
	const built = mutateMotionTextSequence({
		sequence,
		mutation: mutationFrom(input.mutation),
		rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
		...(args.cores?.mutate === undefined ? {} : { core: args.cores.mutate }),
	});
	if (built.sequence === null) rejected(built.diagnostics);
	const result = await args.automation.apply({
		operations: [
			{
				kind: "update-motion-text-sequence",
				sequenceId: sequence.id,
				expectedSequenceRevision,
				sequence: built.sequence,
			},
		],
		expectedRevision: revisionOf(expectedRevision),
		idempotencyKey,
	});
	const response = {
		accepted: true,
		operation: "mutate",
		projectRevision: Number(result.revision),
		sequenceRevision: built.sequence.revision,
		sequenceId: built.sequence.id,
		createdIds: result.createdIds,
		changedIds: result.changedIds,
		affected: affected(sequence, built.sequence),
		diagnostics: built.diagnostics,
	};
	rememberMotionTextRequest({
		journal: args.journal,
		idempotencyKey,
		scope,
		input,
		response,
	});
	return response;
}

export async function varyMotionText(args: {
	readonly automation: AutomationApi;
	readonly sequenceId: string;
	readonly input: unknown;
	readonly apply: boolean;
	readonly cores?: MotionTextFactoryCores;
	readonly journal?: MotionTextRequestJournal;
}): Promise<Readonly<Record<string, unknown>>> {
	const input = record(args.input);
	onlyKeys(input, [
		"salt",
		"cueIds",
		"groups",
		"expectedRevision",
		"expectedSequenceRevision",
		"idempotencyKey",
	]);
	const salt = integer(input.salt, "salt", { maximum: 0xffff_ffff })!;
	const expectedSequenceRevision = integer(
		input.expectedSequenceRevision,
		"expectedSequenceRevision",
	)!;
	const expectedRevision = args.apply
		? integer(input.expectedRevision, "expectedRevision")!
		: undefined;
	const idempotencyKey = args.apply
		? nonEmptyString(input.idempotencyKey, "idempotencyKey")!
		: undefined;
	const scope = `vary:${args.sequenceId}`;
	if (idempotencyKey !== undefined) {
		const replayed = replayMotionTextRequest({
			journal: args.journal,
			idempotencyKey,
			scope,
			input,
		});
		if (replayed !== null) return replayed;
	}
	const cueIds = stringArray(input.cueIds, "cueIds", { optional: true });
	const groupValues = stringArray(input.groups, "groups");
	if (
		!groupValues.every((group) => PRESET_GROUPS.some((item) => item === group))
	) {
		return invalid("groups contains an unsupported preset group.", {
			field: "groups",
			supported: PRESET_GROUPS,
		});
	}
	const sequences = (await args.automation.motionTextSequences?.()) ?? [];
	const sequence = sequenceById(sequences, args.sequenceId);
	assertSequenceRevision(sequence, expectedSequenceRevision);
	const candidate = createMotionTextVariationCandidate({
		sequence,
		salt,
		cueIds,
		groups: groupValues as MotionTextPresetGroup[],
		rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
		...(args.cores?.variation === undefined
			? {}
			: { core: args.cores.variation }),
	});
	if (candidate.sequence === null) {
		rejected(candidate.diagnostics, {
			baseSequenceRevision: candidate.baseRevision,
		});
	}
	if (!args.apply) {
		return {
			accepted: true,
			operation: "vary",
			applied: false,
			projectRevision: Number(await args.automation.revision()),
			baseSequenceRevision: candidate.baseRevision,
			candidateSequenceRevision: candidate.candidateRevision,
			sequenceId: candidate.sequence.id,
			salt: candidate.salt,
			affected: affected(sequence, candidate.sequence),
			diagnostics: candidate.diagnostics,
			candidate: candidate.sequence,
		};
	}
	if (expectedRevision === undefined || idempotencyKey === undefined) {
		return invalid(
			"Applied variations require expectedRevision and idempotencyKey.",
		);
	}
	const result = await args.automation.apply({
		operations: [
			{
				kind: "update-motion-text-sequence",
				sequenceId: sequence.id,
				expectedSequenceRevision,
				sequence: candidate.sequence,
			},
		],
		expectedRevision: revisionOf(expectedRevision),
		idempotencyKey,
	});
	const response = {
		accepted: true,
		operation: "vary",
		applied: true,
		projectRevision: Number(result.revision),
		baseSequenceRevision: candidate.baseRevision,
		sequenceRevision: candidate.candidateRevision,
		sequenceId: candidate.sequence.id,
		salt: candidate.salt,
		createdIds: result.createdIds,
		changedIds: result.changedIds,
		affected: affected(sequence, candidate.sequence),
		diagnostics: candidate.diagnostics,
	};
	rememberMotionTextRequest({
		journal: args.journal,
		idempotencyKey,
		scope,
		input,
		response,
	});
	return response;
}
