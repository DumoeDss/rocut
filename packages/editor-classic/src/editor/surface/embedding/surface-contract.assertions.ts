import type { EditorSession } from "../../session";

import type { EditorSurfaceProps, SurfaceCommitBinding } from "./types";

type RequiredKeys<T> = {
	[K in keyof T]-?: Record<string, never> extends Pick<T, K> ? never : K;
}[keyof T];

type Equal<Left, Right> =
	(<Value>() => Value extends Left ? 1 : 2) extends <
		Value,
	>() => Value extends Right ? 1 : 2
		? true
		: false;

type Assert<Condition extends true> = Condition;

export type EditorSurfaceOnlyRequiresSession = Assert<
	Equal<RequiredKeys<EditorSurfaceProps>, "session">
>;

export type EditorSurfaceSessionUsesFrozenSession = Assert<
	Equal<EditorSurfaceProps["session"], EditorSession>
>;

export type PublicCommitPayloadRemainsOpaque = Assert<
	Equal<Parameters<SurfaceCommitBinding["commit"]>[0], { edit: unknown }>
>;

export type PublicCommitReturnRemainsVoid = Assert<
	Equal<ReturnType<SurfaceCommitBinding["commit"]>, void>
>;
