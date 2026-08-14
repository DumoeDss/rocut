import { useEffect, useState } from "react";

import type { WorkerRequest } from "@opencut/editor-ports";
import { createEditorSession } from "@opencut/editor-classic/session";
import { createElectronEditorHost } from "./host/electron-host-config";

/**
 * The Electron C4 worker fixture harness (task 5.3) — the vite example's
 * `c4-worker-harness.tsx` mirrored against this host's composition. The
 * request URL is deliberately a foreign origin (`request.invalid`): the Host's
 * `createWorker` must serve the fixture from the renderer's own scheme origin
 * through the rewriter the composition threads here, proving the port's
 * "request, not a guarantee" rewrite works end to end on the third host.
 */
const C4_BUILD_MARKER = import.meta.env.VITE_C4_BUILD_MARKER ?? "development";

type HarnessState = {
	status: "starting" | "ready" | "error";
	request: WorkerRequest | null;
	rewrittenUrl: string | null;
	result: unknown;
	created: number;
	released: number;
	error: string | null;
};

export function C4WorkerHarness() {
	const [state, setState] = useState<HarnessState>({
		status: "starting",
		request: null,
		rewrittenUrl: null,
		result: null,
		created: 0,
		released: 0,
		error: null,
	});

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			let observedRequest: WorkerRequest | null = null;
			let rewrittenUrl = "";
			const host = createElectronEditorHost({
				projectId: "c4-worker-fixture",
				onProjectIdChange: () => {},
				onExitProject: () => {},
				workerUrlRewriter: ({ request }) => {
					observedRequest = request;
					const fixtureUrl = new URL(
						"/workers/c4-worker-fixture.js",
						window.location.origin,
					);
					rewrittenUrl = fixtureUrl.toString();
					return fixtureUrl;
				},
			});
			const session = await createEditorSession({ host });
			try {
				const worker = session.resources.createWorker({
					request: {
						id: "c4-round-trip",
						url: new URL("https://request.invalid/original-worker.js"),
						type: "module",
						name: "OpenCut C4 Worker fixture",
					},
				});
				const result = await new Promise<unknown>((resolve, reject) => {
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
					const payload = Uint8Array.from([2, 4, 6, 8]).buffer;
					worker.postMessage({
						message: { kind: "ping", payload },
						transfer: [payload],
					});
				});
				worker.terminate();
				// The session's release bookkeeping settles a microtask after
				// `terminate` (`release()` defers its `released += 1` behind an
				// await); read the settled report, not the mid-flight one, so
				// data-released is the durable observation the port's report
				// exists for.
				await new Promise<void>((resolve) => {
					setTimeout(resolve, 0);
				});
				const report = session.resources.inspect();
				if (!cancelled) {
					setState({
						status: "ready",
						request: observedRequest,
						rewrittenUrl: rewrittenUrl || null,
						result,
						created: report.worker.created,
						released: report.worker.released,
						error: null,
					});
				}
			} finally {
				await session.dispose();
			}
		})().catch((error: unknown) => {
			if (!cancelled) {
				setState((current) => ({
					...current,
					status: "error",
					error: error instanceof Error ? error.message : String(error),
				}));
			}
		});
		return () => {
			cancelled = true;
		};
	}, []);

	return (
		<main
			data-testid="c4-worker-harness"
			data-status={state.status}
			data-request-id={state.request?.id ?? ""}
			data-request-url={state.request?.url.toString() ?? ""}
			data-request-type={state.request?.type ?? ""}
			data-request-name={state.request?.name ?? ""}
			data-rewritten-url={state.rewrittenUrl ?? ""}
			data-created={state.created}
			data-released={state.released}
			data-result={JSON.stringify(state.result)}
			data-c4-build-marker={C4_BUILD_MARKER}
		>
			<h1>C4 Host Worker fixture (electron)</h1>
			{state.error ? <pre data-testid="c4-worker-error">{state.error}</pre> : null}
		</main>
	);
}
