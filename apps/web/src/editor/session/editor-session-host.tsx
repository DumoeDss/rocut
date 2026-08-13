"use client";

import { useEffect, useState } from "react";

import type { EditorHost } from "@opencut/editor-ports/host";
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
	disposal: Promise<void> | null;
	runtime: PreparedWasmRuntimeProviders | null;
}

export function createEditorSessionHostController({
	createSession = createEditorSession,
	prepareRuntime = prepareWasmRuntimeProviders,
	onCleanupError = (error) => {
		console.error("Editor session cleanup failed:", error);
	},
	onChange,
}: {
	createSession?: (args: CreateEditorSessionArgs) => Promise<EditorSession>;
	prepareRuntime?: () => Promise<PreparedWasmRuntimeProviders>;
	onCleanupError?: (error: Error) => void;
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

	function asError({
		reason,
		fallback,
	}: {
		reason: unknown;
		fallback: string;
	}): Error {
		return reason instanceof Error ? reason : new Error(fallback, { cause: reason });
	}

	function cleanupError(errors: Error[]): Error | null {
		if (errors.length === 0) return null;
		if (errors.length === 1) return errors[0]!;
		return new AggregateError(
			errors,
			"Failed to dispose editor session owners.",
		);
	}

	function reportCleanupError(error: Error): void {
		try {
			onCleanupError(error);
		} catch (reportError) {
			console.error(
				"Editor session cleanup error reporter failed:",
				reportError,
			);
		}
	}

	function disposeOwned(generation: HostSessionGeneration): Promise<void> {
		if (generation.disposal) return generation.disposal;

		// Claim both owners before invoking either cleanup. A synchronous throw or
		// re-entrant cancellation can therefore never acquire the same owner twice.
		const session = generation.session;
		const runtime = generation.runtime;
		generation.session = null;
		generation.runtime = null;

		let resolveDisposal!: () => void;
		let rejectDisposal!: (reason: unknown) => void;
		generation.disposal = new Promise<void>((resolve, reject) => {
			resolveDisposal = resolve;
			rejectDisposal = reject;
		});
		const runDisposal = async () => {
			const errors: Error[] = [];
			if (session) {
				try {
					await session.dispose();
				} catch (reason) {
					errors.push(
						asError({
							reason,
							fallback: "Failed to dispose the editor session.",
						}),
					);
				}
			}
			if (runtime) {
				try {
					await runtime.dispose();
				} catch (reason) {
					errors.push(
						asError({
							reason,
							fallback: "Failed to dispose the WASM runtime.",
						}),
					);
				}
			}
			const error = cleanupError(errors);
			if (error) throw error;
		};
		void runDisposal().then(resolveDisposal, rejectDisposal);
		return generation.disposal;
	}

	async function settleCancelledCleanup(
		generation: HostSessionGeneration,
	): Promise<void> {
		try {
			await disposeOwned(generation);
		} catch (reason) {
			reportCleanupError(
				asError({
					reason,
					fallback: "Failed to clean up a cancelled editor session.",
				}),
			);
		}
	}

	async function handleCreationFailure({
		generation,
		reason,
	}: {
		generation: HostSessionGeneration;
		reason: unknown;
	}): Promise<void> {
		const creationError = asError({
			reason,
			fallback: "Failed to create the editor session.",
		});
		let teardownError: Error | null = null;
		try {
			await disposeOwned(generation);
		} catch (cleanupReason) {
			teardownError = asError({
				reason: cleanupReason,
				fallback: "Failed to clean up after editor session creation.",
			});
		}

		if (!generation.active || current !== generation) {
			if (teardownError) reportCleanupError(teardownError);
			return;
		}

		generation.error = teardownError
			? new AggregateError(
					[creationError, teardownError],
					"Failed to create the editor session and clean up its runtime.",
				)
			: creationError;
		publish(generation);
	}

	async function runGeneration(
		generation: HostSessionGeneration,
	): Promise<void> {
		let runtime: PreparedWasmRuntimeProviders;
		try {
			runtime = await prepareRuntime();
		} catch (reason) {
			await handleCreationFailure({ generation, reason });
			return;
		}

		generation.runtime = runtime;
		if (!generation.active || current !== generation) {
			await settleCancelledCleanup(generation);
			return;
		}

		let created: EditorSession;
		try {
			created = await createSession({
				host: generation.host,
				runtimeGraphics: runtime.runtimeGraphics,
				runtimeGpu: runtime.runtimeGpu,
			});
		} catch (reason) {
			await handleCreationFailure({ generation, reason });
			return;
		}

		generation.session = created;
		if (!generation.active || current !== generation) {
			await settleCancelledCleanup(generation);
			return;
		}
		publish(generation);
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
		if (generation.session) void settleCancelledCleanup(generation);
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

			void runGeneration(generation).catch((reason: unknown) => {
				reportCleanupError(
					asError({
						reason,
						fallback: "Unexpected editor session Host failure.",
					}),
				);
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
