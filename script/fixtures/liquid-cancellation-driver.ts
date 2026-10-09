import {
	advanceRenderFrameForHandle,
	beginRenderFrameForHandle,
	cancelRenderFrameForHandle,
	commitRenderFrameForHandle,
	getCompositorCanvasForHandle,
	renderFrameForHandle,
} from "opencut-wasm";
import {
	isRenderCancelledError,
	renderFrameRequest,
	type RenderFrameRequestApi,
} from "../../packages/editor-classic/src/services/renderer/compositor/render-request";
import {
	cancellationFrame,
	cancellationPixels,
	samePixels,
} from "./liquid-cancellation-cases";
import type { SessionResources } from "../../packages/editor-classic/src/editor/session/resources";

export async function checkLiquidCancellationDriver(handle: number) {
	const controller = new AbortController();
	const timers = { created: 0, released: 0, live: 0 };
	const resources: Pick<SessionResources, "setTimeout"> = {
		setTimeout({ handler, ms }) {
			const resourceId = `liquid-boundary:${++timers.created}`;
			timers.live++;
			let active = true;
			const release = () => {
				if (!active) return;
				active = false;
				timers.live--;
				timers.released++;
			};
			const id = window.setTimeout(() => {
				release();
				handler();
			}, ms);
			return {
				resourceId,
				kind: "timeout",
				cancel() {
					window.clearTimeout(id);
					release();
				},
			};
		},
	};
	const canvas = getCompositorCanvasForHandle(handle);
	const frame = cancellationFrame("multiple");
	renderFrameForHandle(handle, cancellationFrame("multiple", false));
	const before = cancellationPixels(canvas);
	let advances = 0,
		commits = 0,
		cancellations = 0;
	const api: RenderFrameRequestApi = {
		beginRenderFrameForHandle,
		advanceRenderFrameForHandle(...args) {
			advances++;
			return advanceRenderFrameForHandle(...args);
		},
		commitRenderFrameForHandle(...args) {
			commits++;
			return commitRenderFrameForHandle(...args);
		},
		cancelRenderFrameForHandle(...args) {
			cancellations++;
			return cancelRenderFrameForHandle(...args);
		},
	};
	const promise = renderFrameRequest({
		api,
		resources,
		handle,
		frame,
		signal: controller.signal,
	});
	if (advances !== 1)
		throw new Error("Driver did not begin real replay before returning");
	let timerObserved = false,
		advancesAtAbort = 0;
	const timer = setTimeout(() => {
		timerObserved = true;
		advancesAtAbort = advances;
		controller.abort();
	}, 0);
	try {
		await promise;
		throw new Error("Task-aborted driver unexpectedly committed");
	} catch (error) {
		if (!isRenderCancelledError(error)) throw error;
	} finally {
		clearTimeout(timer);
	}
	if (!timerObserved || !controller.signal.aborted || advancesAtAbort < 1)
		throw new Error("Driver cancelled before the real abort task executed");
	if (advances < 1 || advances >= 24 || commits !== 0 || cancellations !== 1)
		throw new Error("Driver did not stop unfinished replay before commit");
	if (!samePixels(before, cancellationPixels(canvas)))
		throw new Error("Aborted driver published a partial frame");
	const cancelledCounts = { advances, commits, cancellations };
	if (
		timers.created === 0 ||
		timers.live !== 0 ||
		timers.created !== timers.released
	)
		throw new Error("Cancelled driver did not release its tracked task timers");
	const cancelledTimers = { ...timers };
	await renderFrameRequest({ api, resources, handle, frame });
	const recovered = cancellationPixels(canvas);
	renderFrameForHandle(handle, frame);
	if (
		!samePixels(recovered, cancellationPixels(canvas)) ||
		samePixels(before, recovered)
	)
		throw new Error("Driver recovery differs from synchronous rendering");
	if (timers.live !== 0 || timers.created !== timers.released)
		throw new Error(
			"Successful driver did not release its tracked task timers",
		);
	return {
		realWasm: true,
		realBrowserTask: timerObserved,
		advancesAtAbort,
		cancelledCounts,
		cancelledTimers,
		recoveryTimers: { ...timers },
		recovered: true,
	};
}
