import type {
	MotionTextCue,
	MotionTextLock,
	MotionTextPresetGroup,
} from "@opencut/editor-contracts";

export const MOTION_TEXT_LOCKABLE_PRESET_GROUPS = [
	"style",
	"layout",
	"enter",
	"hold",
	"exit",
	"decor",
	"treat",
	"bg",
	"cam",
	"fx",
	"trans",
] as const satisfies readonly MotionTextPresetGroup[];

export type MotionTextCueField =
	| "text"
	| "timing"
	| "preset"
	| "font"
	| "colors"
	| "parameters";

export function hasMotionTextLock({
	cue,
	scope,
	key,
}: {
	readonly cue: MotionTextCue;
	readonly scope: MotionTextLock["scope"];
	readonly key: string;
}): boolean {
	return cue.locks.some((lock) => lock.scope === scope && lock.key === key);
}

export function hasMotionTextLockScope({
	cue,
	scope,
}: {
	readonly cue: MotionTextCue;
	readonly scope: MotionTextLock["scope"];
}): boolean {
	return cue.locks.some((lock) => lock.scope === scope);
}

export function isMotionTextCueFieldLocked({
	cue,
	field,
}: {
	readonly cue: MotionTextCue;
	readonly field: MotionTextCueField;
}): boolean {
	if (hasMotionTextLock({ cue, scope: "cue", key: "all" })) return true;
	if (field === "text") {
		return hasMotionTextLockScope({ cue, scope: "cut" });
	}
	if (field === "preset") {
		return (
			hasMotionTextLock({ cue, scope: "cue", key: "preset" }) ||
			hasMotionTextLockScope({ cue, scope: "preset-group" })
		);
	}
	if (field === "parameters") {
		return (
			hasMotionTextLock({ cue, scope: "cue", key: "parameters" }) ||
			hasMotionTextLockScope({ cue, scope: "parameter" })
		);
	}
	return false;
}

export function isMotionTextCutBoundaryLocked({
	cue,
	cutId,
	nextCutId,
}: {
	readonly cue: MotionTextCue;
	readonly cutId: string;
	readonly nextCutId: string;
}): boolean {
	return (
		hasMotionTextLock({ cue, scope: "cue", key: "all" }) ||
		hasMotionTextLock({ cue, scope: "cut", key: cutId }) ||
		hasMotionTextLock({ cue, scope: "cut", key: nextCutId })
	);
}

export function motionTextFieldState({
	locked,
	local,
}: {
	readonly locked: boolean;
	readonly local: boolean;
}): "Locked" | "Local" | "Inherited" {
	if (locked) return "Locked";
	return local ? "Local" : "Inherited";
}
