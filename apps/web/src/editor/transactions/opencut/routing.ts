/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- Runtime membership in the frozen routing-class tuple proves the returned discriminated type. */
import {
	COMMAND_ROUTING_CLASSES,
	type Command,
	type CommandRoutingClass,
} from "@/commands/base-command";

export const REGISTERED_COMMAND_NAMES = Object.freeze(
	[
		"AddClipEffectCommand",
		"AddMediaAssetCommand",
		"AddTrackCommand",
		"BatchCommand",
		"CreateSceneCommand",
		"DeleteElementsCommand",
		"DeleteFreeformPathMaskPointsCommand",
		"DeleteSceneCommand",
		"DuplicateElementsCommand",
		"InsertElementCommand",
		"InsertFreeformPathMaskPointCommand",
		"MoveBookmarkCommand",
		"MoveElementCommand",
		"PasteCommand",
		"PasteKeyframesCommand",
		"RemoveBookmarkCommand",
		"RemoveClipEffectCommand",
		"RemoveEffectParamKeyframeCommand",
		"RemoveKeyframeCommand",
		"RemoveMaskCommand",
		"RemoveMediaAssetCommand",
		"RemoveTrackCommand",
		"RenameSceneCommand",
		"ReorderClipEffectsCommand",
		"RetimeKeyframeCommand",
		"SplitElementsCommand",
		"ToggleBookmarkCommand",
		"ToggleClipEffectCommand",
		"ToggleMaskInvertedCommand",
		"ToggleSourceAudioSeparationCommand",
		"ToggleTrackMuteCommand",
		"ToggleTrackVisibilityCommand",
		"TracksSnapshotCommand",
		"UpdateBookmarkCommand",
		"UpdateClipEffectParamsCommand",
		"UpdateElementsCommand",
		"UpdateProjectSettingsCommand",
		"UpdateScalarKeyframeCurveCommand",
		"UpsertEffectParamKeyframeCommand",
		"UpsertKeyframeCommand",
	].sort(),
);

export function classifyCommand(command: Command): CommandRoutingClass {
	const explicit: unknown = command.routingClass;
	if (
		typeof explicit === "string" &&
		(COMMAND_ROUTING_CLASSES as readonly string[]).includes(explicit)
	) {
		return explicit as CommandRoutingClass;
	}
	const name = command.constructor.name;
	throw new Error(
		`Command ${name || "<anonymous>"} has no routing registration`,
	);
}
