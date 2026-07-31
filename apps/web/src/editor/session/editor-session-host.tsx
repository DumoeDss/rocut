"use client";

import { useEffect, useState } from "react";

import type { EditorHost } from "@/editor/host/editor-host";
import { EditorHostProvider } from "@/editor/host/editor-host-context";
import {
	UNIMPLEMENTED_RUNTIME_GPU,
	UNIMPLEMENTED_RUNTIME_GRAPHICS,
} from "@/editor/ports";

import { createEditorSession } from "./create-session";
import { EditorSessionProvider } from "./editor-session-provider";
import type { EditorSession } from "./session-types";

export function EditorSessionHost({
	host,
	children,
}: {
	host: EditorHost;
	children: React.ReactNode;
}) {
	const [session, setSession] = useState<EditorSession | null>(null);
	const [error, setError] = useState<Error | null>(null);

	useEffect(() => {
		let active = true;
		let ownedSession: EditorSession | null = null;

		void createEditorSession({
			host,
			runtimeGraphics: UNIMPLEMENTED_RUNTIME_GRAPHICS,
			runtimeGpu: UNIMPLEMENTED_RUNTIME_GPU,
		})
			.then(async (created) => {
				if (!active) {
					await created.dispose();
					return;
				}
				ownedSession = created;
				setSession(created);
			})
			.catch((reason: unknown) => {
				if (!active) return;
				setError(
					reason instanceof Error
						? reason
						: new Error("Failed to create the editor session."),
				);
			});

		return () => {
			active = false;
			setSession(null);
			if (ownedSession) {
				void ownedSession.dispose();
			}
		};
	}, [host]);

	if (error) throw error;

	return (
		<EditorHostProvider host={host}>
			{session ? (
				<EditorSessionProvider session={session}>
					{children}
				</EditorSessionProvider>
			) : null}
		</EditorHostProvider>
	);
}
