"use client";

import { useEffect, useState } from "react";

import type { EditorHost } from "@/editor/host/editor-host";
import { EditorHostProvider } from "@/editor/host/editor-host-context";
import {
	UNIMPLEMENTED_RUNTIME_GPU,
	UNIMPLEMENTED_RUNTIME_GRAPHICS,
} from "@/editor/ports";

import {
	createEditorSession,
	type CreateEditorSessionArgs,
} from "./create-session";
import { EditorSessionProvider } from "./editor-session-provider";
import type { EditorSession } from "./session-types";

interface HostSessionSnapshot {
	host: EditorHost;
	generation: number;
	session: EditorSession | null;
	error: Error | null;
}

interface HostSessionGeneration extends HostSessionSnapshot {
	active: boolean;
	disposal: Promise<unknown> | null;
}

export function createEditorSessionHostController({
	createSession = createEditorSession,
	onChange,
}: {
	createSession?: (args: CreateEditorSessionArgs) => Promise<EditorSession>;
	onChange: (snapshot: HostSessionSnapshot | null) => void;
}) {
	let nextGeneration = 0;
	let current: HostSessionGeneration | null = null;

	function publish(generation: HostSessionGeneration | null): void {
		onChange(
			generation
				? {
						host: generation.host,
						generation: generation.generation,
						session: generation.session,
						error: generation.error,
					}
				: null,
		);
	}

	function disposeOwned(generation: HostSessionGeneration): Promise<unknown> {
		if (!generation.session) return Promise.resolve();
		generation.disposal ??= generation.session.dispose();
		return generation.disposal;
	}

	function cancel(generation: HostSessionGeneration): void {
		if (!generation.active) return;
		generation.active = false;
		if (current === generation) {
			current = null;
			publish(null);
		}
		void disposeOwned(generation);
	}

	return {
		begin(host: EditorHost): () => void {
			if (current) cancel(current);
			const generation: HostSessionGeneration = {
				host,
				generation: ++nextGeneration,
				session: null,
				error: null,
				active: true,
				disposal: null,
			};
			current = generation;
			publish(generation);

			void createSession({
				host,
				runtimeGraphics: UNIMPLEMENTED_RUNTIME_GRAPHICS,
				runtimeGpu: UNIMPLEMENTED_RUNTIME_GPU,
			})
				.then(async (created) => {
					generation.session = created;
					if (!generation.active || current !== generation) {
						await disposeOwned(generation);
						return;
					}
					publish(generation);
				})
				.catch((reason: unknown) => {
					if (!generation.active || current !== generation) return;
					generation.error =
						reason instanceof Error
							? reason
							: new Error("Failed to create the editor session.");
					publish(generation);
				});

			return () => cancel(generation);
		},

		currentForHost(host: EditorHost): HostSessionSnapshot | null {
			if (!current || !current.active || current.host !== host) return null;
			return current;
		},
	};
}

export function EditorSessionHost({
	host,
	children,
}: {
	host: EditorHost;
	children: React.ReactNode;
}) {
	const [snapshot, setSnapshot] = useState<HostSessionSnapshot | null>(null);
	const [controller] = useState(() =>
		createEditorSessionHostController({ onChange: setSnapshot }),
	);

	useEffect(() => {
		return controller.begin(host);
	}, [controller, host]);

	const current = controller.currentForHost(host);
	// Consume the state value as the React subscription token. The controller
	// still performs the authoritative Host/generation identity check.
	if (snapshot && current?.generation !== snapshot.generation) return null;

	if (current?.error) throw current.error;

	return (
		<EditorHostProvider host={host}>
			{current?.session ? (
				<EditorSessionProvider session={current.session}>
					{children}
				</EditorSessionProvider>
			) : null}
		</EditorHostProvider>
	);
}
