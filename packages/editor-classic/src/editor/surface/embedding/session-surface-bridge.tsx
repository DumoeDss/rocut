"use client";

import { useMemo } from "react";

import { editorForSession } from "../../runtime/session-core-owner";
import { useEditorSession } from "../../session";

import { EditorSurface } from "./editor-surface";
import { createSurfaceCommitBinding } from "./surface-transaction-binding";
import type { EditorSurfaceProps } from "./types";

type SessionEditorSurfaceProps = Omit<
	EditorSurfaceProps,
	"session" | "commitBinding"
>;

/**
 * Production-only bridge from the outer session owner to the public Surface.
 * It reuses the one facade already owned by EditorCore; no engine is opened and
 * no command/pointer event is intercepted here.
 */
export function SessionEditorSurface({
	onError,
	...surfaceProps
}: SessionEditorSurfaceProps) {
	const session = useEditorSession();
	const binding = useMemo(
		() =>
			createSurfaceCommitBinding({
				apply: editorForSession(session).transactions,
				onError: (error) => onError?.(error),
			}),
		[onError, session],
	);

	return (
		<EditorSurface
			{...surfaceProps}
			session={session}
			commitBinding={binding}
			onError={onError}
		/>
	);
}
