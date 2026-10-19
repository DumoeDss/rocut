import type { ShortcutKey } from "./keybinding";
import type { TActionWithOptionalArgs } from "./types";

export type TActionCategory =
	| "playback"
	| "navigation"
	| "editing"
	| "selection"
	| "history"
	| "timeline"
	| "controls"
	| "assets";

export interface TActionBaseDefinition {
	description: string;
	category: TActionCategory;
	args?: Record<string, unknown>;
}

export interface TActionDefinition extends TActionBaseDefinition {
	defaultShortcuts?: readonly ShortcutKey[];
}

export const ACTIONS = {
	"toggle-play": {
		description: "播放 / 暂停",
		category: "playback",
	},
	"stop-playback": {
		description: "停止播放",
		category: "playback",
	},
	"seek-forward": {
		description: "前进 1 秒",
		category: "playback",
		args: { seconds: "number" },
	},
	"seek-backward": {
		description: "后退 1 秒",
		category: "playback",
		args: { seconds: "number" },
	},
	"frame-step-forward": {
		description: "前进一帧",
		category: "navigation",
	},
	"frame-step-backward": {
		description: "后退一帧",
		category: "navigation",
	},
	"jump-forward": {
		description: "前进 5 秒",
		category: "navigation",
		args: { seconds: "number" },
	},
	"jump-backward": {
		description: "后退 5 秒",
		category: "navigation",
		args: { seconds: "number" },
	},
	"goto-start": {
		description: "跳到时间线开头",
		category: "navigation",
	},
	"goto-end": {
		description: "跳到时间线结尾",
		category: "navigation",
	},
	split: {
		description: "在播放头处分割片段",
		category: "editing",
	},
	"split-left": {
		description: "分割并移除左侧",
		category: "editing",
	},
	"split-right": {
		description: "分割并移除右侧",
		category: "editing",
	},
	"delete-selected": {
		description: "删除选中内容",
		category: "editing",
	},
	"copy-selected": {
		description: "复制选中片段",
		category: "editing",
	},
	"paste-copied": {
		description: "在播放头处粘贴片段",
		category: "editing",
	},
	"toggle-snapping": {
		description: "切换自动吸附",
		category: "editing",
	},
	"toggle-ripple-editing": {
		description: "切换波纹编辑",
		category: "editing",
	},
	"toggle-source-audio": {
		description: "分离 / 恢复原始音频",
		category: "editing",
	},
	"select-all": {
		description: "选择全部片段",
		category: "selection",
	},
	"cancel-interaction": {
		description: "取消当前操作",
		category: "controls",
	},
	"deselect-all": {
		description: "取消全部选择",
		category: "selection",
	},
	"duplicate-selected": {
		description: "创建选中片段副本",
		category: "selection",
	},
	"toggle-elements-muted-selected": {
		description: "静音 / 取消静音选中片段",
		category: "selection",
	},
	"toggle-elements-visibility-selected": {
		description: "显示 / 隐藏选中片段",
		category: "selection",
	},
	"toggle-bookmark": {
		description: "添加 / 移除播放头书签",
		category: "timeline",
	},
	undo: {
		description: "撤销",
		category: "history",
	},
	redo: {
		description: "重做",
		category: "history",
	},
	"remove-media-asset": {
		description: "移除素材",
		category: "assets",
		args: { projectId: "string", assetId: "string" },
	},
	"remove-media-assets": {
		description: "移除素材s",
		category: "assets",
		args: { projectId: "string", assetIds: "string[]" },
	},
} as const satisfies Record<string, TActionBaseDefinition>;

export type TAction = keyof typeof ACTIONS;

/**
 * The actions whose argument is **required** — the complement of
 * `TActionWithOptionalArgs`. Computed, never listed, so it cannot disagree with
 * `TActionArgsMap`.
 *
 * Note this is *not* `TActionWithArgs`: that also covers the four seek/jump
 * actions, whose `TActionArgsMap` entries include `undefined` and which are
 * therefore valid `TActionWithOptionalArgs`.
 */
type TActionWithRequiredArgs = Exclude<TAction, TActionWithOptionalArgs>;

/**
 * Annotated as `Record<TActionWithRequiredArgs, true>` so drift is a **compile**
 * error in both directions: the moment an action's `TActionArgsMap` entry stops
 * including `undefined`, that action joins `TActionWithRequiredArgs` and this
 * object literal no longer type-checks until it is listed here. An unknown key is
 * rejected too. A `satisfies` on an array would catch only the second, and it is
 * the first — a new required-args action silently accepted by the guard — that
 * matters.
 */
const ACTIONS_WITH_REQUIRED_ARGS: Record<TActionWithRequiredArgs, true> = {
	"remove-media-asset": true,
	"remove-media-assets": true,
};

const ACTION_SET: ReadonlySet<string> = new Set(Object.keys(ACTIONS));

const REQUIRED_ARGS_ACTION_SET: ReadonlySet<string> = new Set(
	Object.keys(ACTIONS_WITH_REQUIRED_ARGS),
);

/**
 * Whether a string names an action that can be invoked without an argument, and
 * so may be bound to a keyboard shortcut.
 *
 * Derived from the runtime `ACTIONS` table, **not** from
 * `ACTION_DEFAULT_SHORTCUTS`. The committed test in
 * `keybindings/__tests__/persistence.test.ts` pins this: `stop-playback` is a
 * valid `TActionWithOptionalArgs` and is absent from the defaults table, and the
 * validator must still accept it.
 *
 * Answering **OQ1**: the two required-args actions are rejected at runtime, not
 * merely excluded by the type. Binding `remove-media-asset` to a key would invoke
 * it with no argument, so accepting it here would persist a shortcut that cannot
 * work. `ACTIONS_WITH_REQUIRED_ARGS` above makes that decision drift-proof.
 */
export function isActionWithOptionalArgs(
	value: string,
): value is TActionWithOptionalArgs {
	return ACTION_SET.has(value) && !REQUIRED_ARGS_ACTION_SET.has(value);
}

const ACTION_DEFAULT_SHORTCUTS = [
	["toggle-play", ["space", "k"]],
	["seek-forward", ["l"]],
	["seek-backward", ["j"]],
	["frame-step-forward", ["right"]],
	["frame-step-backward", ["left"]],
	["jump-forward", ["shift+right"]],
	["jump-backward", ["shift+left"]],
	["goto-start", ["home", "enter"]],
	["goto-end", ["end"]],
	["split", ["s"]],
	["split-left", ["q"]],
	["split-right", ["w"]],
	["delete-selected", ["backspace", "delete"]],
	["copy-selected", ["ctrl+c"]],
	["paste-copied", ["ctrl+v"]],
	["toggle-snapping", ["n"]],
	["select-all", ["ctrl+a"]],
	["cancel-interaction", ["escape"]],
	["duplicate-selected", ["ctrl+d"]],
	["undo", ["ctrl+z"]],
	["redo", ["ctrl+shift+z", "ctrl+y"]],
] as const satisfies ReadonlyArray<
	readonly [TActionWithOptionalArgs, readonly ShortcutKey[]]
>;

const ACTION_DEFAULT_SHORTCUTS_BY_ACTION = new Map<
	TAction,
	readonly ShortcutKey[]
>(ACTION_DEFAULT_SHORTCUTS);

export function getActionDefinition({
	action,
}: {
	action: TAction;
}): TActionDefinition {
	return {
		...ACTIONS[action],
		defaultShortcuts: ACTION_DEFAULT_SHORTCUTS_BY_ACTION.get(action),
	};
}

export function getDefaultShortcuts(): Map<
	ShortcutKey,
	TActionWithOptionalArgs
> {
	const shortcuts = new Map<ShortcutKey, TActionWithOptionalArgs>();

	for (const [action, defaultShortcuts] of ACTION_DEFAULT_SHORTCUTS) {
		for (const shortcut of defaultShortcuts) {
			shortcuts.set(shortcut, action);
		}
	}

	return shortcuts;
}
