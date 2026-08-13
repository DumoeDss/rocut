"use client";

import { useEffect, useState } from "react";

import { editorForSession } from "@/editor/runtime/session-core-owner";
import { storesForSession } from "@/editor/runtime/session-stores";
import { useEditorSession } from "@/editor/session";
import { useEditor } from "@/editor/use-editor";
import { isC4ProjectLoadComplete } from "@opencut/editor-classic/browser";

type ProbeMode = "worker" | "forced-none";

type ProbeState =
	| { status: "starting" }
	| { status: "ready"; result: Record<string, unknown> }
	| { status: "error"; error: string };

function errorText(value: unknown): string {
	return value instanceof Error ? value.message : String(value);
}

export function C4NextRuntimeProbe({ mode }: { mode: ProbeMode }) {
	const session = useEditorSession();
	const projectLoaded = useEditor(isC4ProjectLoadComplete);
	const [state, setState] = useState<ProbeState>({ status: "starting" });

	useEffect(() => {
		if (!projectLoaded) return;

		let cancelled = false;
		const pageErrors: string[] = [];
		const unhandledRejections: string[] = [];
		const onError = (event: ErrorEvent) =>
			pageErrors.push(errorText(event.error ?? event.message));
		const onUnhandled = (event: PromiseRejectionEvent) =>
			unhandledRejections.push(errorText(event.reason));
		window.addEventListener("error", onError);
		window.addEventListener("unhandledrejection", onUnhandled);

		void (async () => {
			if (mode === "worker") {
				const request = {
					id: "c4-next-round-trip",
					url: new URL("https://request.invalid/next-worker.js"),
					type: "module" as const,
					name: "OpenCut C4 Next Worker fixture",
				};
				const worker = session.resources.createWorker({ request });
				try {
					const response = await new Promise<unknown>((resolve, reject) => {
						const offMessage = worker.onMessage((event) => {
							offMessage();
							offError();
							resolve(event.data);
						});
						const offError = worker.onError((event) => {
							offMessage();
							offError();
							reject(new Error(event.message));
						});
						const payload = Uint8Array.from([1, 3, 5, 7]).buffer;
						worker.postMessage({
							message: { kind: "ping", payload },
							transfer: [payload],
						});
					});
					worker.terminate();
					// SessionResources publishes release counts after its async release
					// continuation, even when the underlying Worker terminates synchronously.
					await Promise.resolve();
					const resources = session.resources.inspect();
					if (!cancelled) {
						setState({
							status: "ready",
							result: {
								request: {
									id: request.id,
									url: request.url.toString(),
									type: request.type,
									name: request.name,
								},
								rewrittenUrl: session.host.assets.resolve({
									ref: { path: "workers/c4-worker-fixture.js" },
								}),
								response,
								created: resources.worker.created,
								released: resources.worker.released,
								pageErrors,
								unhandledRejections,
							},
						});
					}
				} finally {
					worker.terminate();
				}
				return;
			}

			storesForSession(session).assetsPanel.setState({ activeTab: "effects" });
			await new Promise<void>((resolve) => window.setTimeout(resolve, 1_750));
			const editor = editorForSession(session);
			const report = await session.capabilities.graphics();
			const statusText = Array.from(
				document.querySelectorAll<HTMLElement>('[role="status"]'),
			).map((element) => element.textContent ?? "");
			const resources = session.resources.inspect();
			if (!cancelled) {
				setState({
					status: "ready",
					result: {
						report,
						sessionState: session.state,
						bannerVisible: statusText.some((text) =>
							text.includes("Renderer unavailable in this environment"),
						),
						previewUnavailableVisible: statusText.some((text) =>
							text.includes("Preview unavailable"),
						),
						effectPreviewCount: Array.from(
							document.querySelectorAll<HTMLCanvasElement>("canvas"),
						).filter((canvas) => canvas.width === 160 && canvas.height === 160)
							.length,
						renderTreeIsNull: editor.renderer.getRenderTree() === null,
						compositorHandle: editor.renderer.getCompositorHandle(),
						gpuWorkCount: resources.gpuResource.created,
						pageErrors,
						unhandledRejections,
					},
				});
			}
		})().catch((error: unknown) => {
			if (!cancelled) setState({ status: "error", error: errorText(error) });
		});

		return () => {
			cancelled = true;
			window.removeEventListener("error", onError);
			window.removeEventListener("unhandledrejection", onUnhandled);
		};
	}, [mode, projectLoaded, session]);

	const visibleState: ProbeState = projectLoaded
		? state
		: { status: "starting" };

	return (
		<output
			data-testid="c4-next-runtime-probe"
			data-mode={mode}
			data-status={visibleState.status}
			data-result={
				visibleState.status === "ready"
					? JSON.stringify(visibleState.result)
					: ""
			}
			data-error={visibleState.status === "error" ? visibleState.error : ""}
			className="sr-only"
		/>
	);
}
