"use client";

import { useEffect, useState } from "react";

import type { EditorHost } from "@/editor/host/editor-host";
import { EditorHostProvider } from "@/editor/host/editor-host-context";
import {
	prepareWasmRuntimeProviders,
	type PreparedWasmRuntimeProviders,
} from "@/editor/runtime/wasm-runtime-providers";

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
	runtime: PreparedWasmRuntimeProviders | null;
}

export function createEditorSessionHostController({
	createSession = createEditorSession,
	prepareRuntime = prepareWasmRuntimeProviders,
	onChange,
}: {
	createSession?: (args: CreateEditorSessionArgs) => Promise<EditorSession>;
	prepareRuntime?: () => Promise<PreparedWasmRuntimeProviders>;
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
		if (!generation.session) {
			generation.runtime?.dispose();
			generation.runtime = null;
			return Promise.resolve();
		}
		generation.disposal ??= generation.session.dispose().finally(() => {
			generation.runtime?.dispose();
			generation.runtime = null;
		});
		return generation.disposal;
	}

	function cancel(generation: HostSessionGeneration): void {
		if (!generation.active) return;
		generation.active = false;
		if (current === generation) {
			current = null;
			publish(null);
		}
		// A generation whose createSession() call is still pending must retain its
		// query wrappers. The settlement chain below disposes a late-created session
		// first, while those wrappers are live, and frees them afterwards. A rejected
		// creation has no session to inspect and can free the wrappers directly.
		if (generation.session) void disposeOwned(generation);
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
				runtime: null,
			};
			current = generation;
			publish(generation);

			void prepareRuntime()
				.then(async (runtime) => {
					generation.runtime = runtime;
					if (!generation.active || current !== generation) {
						runtime.dispose();
						generation.runtime = null;
						return null;
					}
					return createSession({
						host,
						runtimeGraphics: runtime.runtimeGraphics,
						runtimeGpu: runtime.runtimeGpu,
					});
				})
				.then(async (created) => {
					if (!created) return;
					generation.session = created;
					if (!generation.active || current !== generation) {
						await disposeOwned(generation);
						return;
					}
					publish(generation);
				})
				.catch((reason: unknown) => {
					if (!generation.active || current !== generation) {
						void disposeOwned(generation);
						return;
					}
					void disposeOwned(generation);
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
