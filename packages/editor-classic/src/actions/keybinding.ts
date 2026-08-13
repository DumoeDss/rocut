import type { TActionWithOptionalArgs } from "./types";

/**
 * Alt is also regarded as macOS OPTION (⌥) key
 * Ctrl is also regarded as macOS COMMAND (⌘) key (NOTE: this differs from HTML Keyboard spec where COMMAND is Meta key!)
 */
export type ModifierKeys =
	| "ctrl"
	| "alt"
	| "shift"
	| "ctrl+shift"
	| "alt+shift"
	| "ctrl+alt"
	| "ctrl+alt+shift";

const KEYS = [
	"a", "b", "c", "d", "e", "f", "g", "h", "i", "j",
	"k", "l", "m", "n", "o", "p", "q", "r", "s", "t",
	"u", "v", "w", "x", "y", "z",
	"0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
	"up", "down", "left", "right",
	"/", "?", ".",
	"enter", "tab", "space", "escape", "esc",
	"backspace", "delete", "home", "end",
] as const;

export type Key = (typeof KEYS)[number];

const KEY_SET: ReadonlySet<string> = new Set(KEYS);

export function isKey(value: string): value is Key {
	return KEY_SET.has(value);
}

export type ModifierBasedShortcutKey = `${ModifierKeys}+${Key}`;
// Singular keybindings (these will be disabled when an input-ish area has been focused)
export type SingleCharacterShortcutKey = `${Key}`;

export type ShortcutKey = ModifierBasedShortcutKey | SingleCharacterShortcutKey;

/**
 * Typed as `Record<ModifierKeys, true>` rather than a plain array so the compiler
 * checks the list in **both** directions: a missing member and an unknown member
 * are each a compile error. A `satisfies readonly ModifierKeys[]` on an array
 * would only reject an unknown member, and it is the *missing* one that would
 * silently make a valid shortcut unrecognised.
 */
const MODIFIER_KEY_COMBINATIONS: Record<ModifierKeys, true> = {
	ctrl: true,
	alt: true,
	shift: true,
	"ctrl+shift": true,
	"alt+shift": true,
	"ctrl+alt": true,
	"ctrl+alt+shift": true,
};

const MODIFIER_KEY_SET: ReadonlySet<string> = new Set(
	Object.keys(MODIFIER_KEY_COMBINATIONS),
);

/**
 * Whether a string is a `ShortcutKey` — either a bare `Key` or a `ModifierKeys`
 * prefixed combination such as `ctrl+shift+z`.
 *
 * Shaped after `isKey` above, which is the precedent for a guard over these
 * tables. A single positional subject is the conforming form for a type predicate
 * under `opencut/prefer-object-params`, which carves them out explicitly rather
 * than treating them as an exception.
 *
 * The split is on the **last** `+`: modifier combinations contain `+`
 * (`ctrl+alt+shift`) while no `Key` does, so `ctrl+alt+shift+z` separates into the
 * modifier `ctrl+alt+shift` and the key `z`. An unknown key such as `shift+bogus`
 * fails on the `isKey` half.
 */
export function isShortcutKey(value: string): value is ShortcutKey {
	if (isKey(value)) {
		return true;
	}

	const separatorIndex = value.lastIndexOf("+");
	if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
		return false;
	}

	return (
		MODIFIER_KEY_SET.has(value.slice(0, separatorIndex)) &&
		isKey(value.slice(separatorIndex + 1))
	);
}

export type KeybindingConfig = {
	[key in ShortcutKey]?: TActionWithOptionalArgs;
};
