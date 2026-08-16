/**
 * sdk-export-capability — the hidden export producer window's entry (design
 * D3/D4). Plain TypeScript, no React: this window mounts no UI. It boots the
 * SAME editor session stack the interactive window boots (the composition
 * root from `../host/electron-host-config`, the wasm runtime providers, the
 * session-owned `EditorCore`), loads the assigned project, and then streams
 * the timeline out as RGB24 frame batches over the export bridge until the
 * main-process `ExportJobManager` hands the file to FFmpeg.
 *
 * Why the interactive-window host config is reused rather than a smaller
 * variant: `createElectronEditorHost` is the single composition root that
 * owns the durable `FilesystemProjectStore` over the preload bridge and the
 * wasm `ElectronRuntimeResources` — the two roles this producer cannot live
 * without. The interactive roles it also composes (`navigation`,
 * `branding`, `links`, the in-memory defaults underneath) are inert without
 * a mounted React surface, so reusing the root costs nothing and keeps one
 * definition of "how this process talks to the editor". The two interactive
 * callbacks are stubbed below and named as such.
 *
 * The render loop mirrors the in-process donor,
 * `packages/editor-classic/src/core/managers/renderer-manager.ts`
 * `exportProject` + `services/renderer/scene-exporter.ts` `runExport`:
 * identical `buildScene` construction, identical TICKS-per-frame math, the
 * same `renderAndCapture` publication-guarded capture — the difference is
 * only where the captured bytes go (IPC frame batches instead of a
 * mediabunny `CanvasSource`; the main process owns encoding via FFmpeg).
 *
 * Resource discipline (C6): the producer is fully event-driven — frame
 * backpressure is the `frameAck` promise, job termination is the `settled`
 * event — so this file needs no timers of its own.
 */
import { TICKS_PER_SECOND } from "@opencut/editor-classic";
import { loadFontAtlas } from "@opencut/editor-classic/fonts";
import { extractTimelineAudio } from "@opencut/editor-classic/media";
import { buildScene } from "@opencut/editor-classic/renderer";
import {
	editorForSession,
	prepareWasmRuntimeProviders,
} from "@opencut/editor-classic/runtime";
import { createEditorSession } from "@opencut/editor-classic/session";
import type {
	AudioWireArgs,
	BeginExportWireArgs,
	BeginExportWireResult,
	ExportJobWireSnapshot,
	FrameAckMessage,
	FrameBatchMessage,
	JobEventMessage,
} from "../export/export-ipc-contract";
import { projectTimelineDigest } from "../export/export-ipc-contract";
import { createElectronEditorHost } from "../host/electron-host-config";
import { rgbaToRgb24 } from "./rgb24";

// -- the preload surface, typed narrow ------------------------------------------------
// The sandboxed preload cannot share modules with the bundle, so the bridge
// crosses as untyped globals; these structural views spell out exactly the
// slice this producer uses (the contract types above are the vocabulary).

interface ExportBridgeGlobal {
	getJob(jobId: string): Promise<ExportJobWireSnapshot | null>;
	beginExport(args: BeginExportWireArgs): Promise<BeginExportWireResult>;
	sendFrame(message: FrameBatchMessage): void;
	audio(args: AudioWireArgs): Promise<{ accepted: boolean }>;
	finalize(jobId: string): Promise<unknown>;
	failJob(jobId: string, reason: string): Promise<unknown>;
	jobDone(jobId: string): Promise<unknown>;
	onJobEvent(handler: (message: JobEventMessage) => void): () => void;
	onFrameAck(handler: (message: FrameAckMessage) => void): () => void;
}

interface StoreBridgeGlobal {
	loadRecord(id: string): Promise<{
		readonly record: { readonly data: unknown };
		readonly summary: { readonly updatedAt: string };
	} | null>;
}

interface PreloadGlobals {
	readonly opencutExport?: ExportBridgeGlobal;
	readonly opencutStore?: StoreBridgeGlobal;
}

// -- batch sizing ---------------------------------------------------------------

/** At most four frames per IPC batch (the spec's in-flight ceiling). */
const BATCH_FRAME_LIMIT = 4;
/** …or 8 MB of RGB24, whichever admits fewer frames. */
const BATCH_BYTES_LIMIT = 8 * 1024 * 1024;

/** The donor's named refusal when no rasterizer exists — mirrored verbatim. */
const RASTERIZER_UNAVAILABLE_REASON =
	"Renderer unavailable: this environment has no rasterizer";

function errorText(value: unknown): string {
	return value instanceof Error ? value.message : String(value);
}

function readParam(params: URLSearchParams, name: string): string | null {
	const value = params.get(name);
	return value !== null && value.length > 0 ? value : null;
}

async function main(): Promise<void> {
	const params = new URLSearchParams(window.location.search);
	const projectId = readParam(params, "project");
	const jobId = readParam(params, "job");
	const globals = window as unknown as PreloadGlobals;
	const bridge = globals.opencutExport;
	if (projectId === null || jobId === null || bridge === undefined) {
		// No failJob channel exists for a misrouted window: main never opened
		// one without both params, so this is a developer-mode visit.
		console.error(
			`export-renderer: needs ?project=&job= and the export preload (got project=${String(projectId)} job=${String(jobId)})`,
		);
		return;
	}

	// Settled-wait and ack machinery, installed BEFORE beginExport so no
	// transition can slip past the subscription. `settledSignal` releases
	// every wait on the job's terminal event — completed, failed, OR
	// cancelled — including an ack that will never come (a rejected batch
	// fails the job and main answers no ack).
	let settledRelease: (() => void) | null = null;
	const settledSignal = new Promise<void>((resolve) => {
		settledRelease = resolve;
	});
	let ackWaiter: ((ack: FrameAckMessage | null) => void) | null = null;
	const releaseAck = (ack: FrameAckMessage | null): void => {
		const waiter = ackWaiter;
		ackWaiter = null;
		waiter?.(ack);
	};
	const offJobEvent = bridge.onJobEvent((message: JobEventMessage) => {
		if (message.jobId !== jobId || message.event.type !== "settled") return;
		releaseAck(null);
		settledRelease?.();
	});
	const offFrameAck = bridge.onFrameAck((message: FrameAckMessage) => {
		if (message.jobId !== jobId) return;
		releaseAck(message);
	});

	/** One batch in flight at a time; null ack = the job settled mid-flight. */
	const sendBatchAwaitAck = (
		message: FrameBatchMessage,
	): Promise<FrameAckMessage | null> =>
		new Promise((resolve) => {
			ackWaiter = resolve;
			bridge.sendFrame(message);
		});

	try {
		const snapshot = await bridge.getJob(jobId);
		if (snapshot === null) {
			console.error(`export-renderer: unknown job ${jobId}`);
			return;
		}
		if (
			snapshot.phase === "completed" ||
			snapshot.phase === "failed" ||
			snapshot.phase === "cancelled"
		) {
			// Attached to a dead job (window raced the settlement); nothing
			// to produce, and belt-and-braces tells main we are finished.
			await bridge.jobDone(jobId);
			return;
		}

		// -- boot the editor stack (the c6-durable-reopen canonical order) ----
		const host = createElectronEditorHost({
			projectId,
			// Interactive-window callbacks this headless window stubs: the
			// navigation roles are inert without a mounted React surface.
			onProjectIdChange: () => {},
			onExitProject: () => {},
		});
		const runtime = await prepareWasmRuntimeProviders();
		const session = await createEditorSession({
			host,
			runtimeGraphics: runtime.runtimeGraphics,
			runtimeGpu: runtime.runtimeGpu,
		});
		const editor = editorForSession(session);

		const fail = async (reason: string): Promise<void> => {
			console.error(`export-renderer: failing job ${jobId}: ${reason}`);
			try {
				await bridge.failJob(jobId, reason);
			} catch (error) {
				// A settled job (e.g. cancelled while we booted) refuses
				// failJob; the settled event already ended the wait.
				console.error(
					`export-renderer: failJob refused (job already settled): ${errorText(error)}`,
				);
			}
		};

		// Degraded graphics is a named producer-side failure, the donor's
		// first export guard.
		const graphics = await session.capabilities.graphics();
		editor.renderer.setDegraded(graphics.rasterizer === "none");
		if (editor.renderer.isDegraded) {
			await fail(RASTERIZER_UNAVAILABLE_REASON);
			return;
		}

		// The complete minimal load: persistence → project fonts → live state
		// drain → media → transactions → scenes (project-manager.loadProject
		// finishes all of it before resolving), then the font atlas so text
		// elements have glyph chunks at render time (use-font-atlas's own
		// discipline, awaited here because there is no React mount to do it).
		try {
			await editor.project.loadProject({ id: projectId });
		} catch (error) {
			await fail(`export-renderer: failed to load project ${projectId}: ${errorText(error)}`);
			return;
		}
		await loadFontAtlas({
			loader: session.host.assetLoader,
			resolver: session.host.assets,
		});

		// -- derive the render spec the way the donor's exportProject does ----
		const project = editor.project.getActive();
		const duration = editor.timeline.getTotalDuration();
		if (duration === 0) {
			await fail("Project is empty");
			return;
		}
		const fps = snapshot.request.fps ?? project.settings.fps;
		const ticksPerFrame = Math.round(
			(TICKS_PER_SECOND * fps.denominator) / fps.numerator,
		);
		const totalFrames = Math.floor(duration / ticksPerFrame);
		if (totalFrames < 1) {
			await fail("export-renderer: timeline is shorter than one frame");
			return;
		}

		// The stale-timeline guard's producer declaration: the same summary
		// main resolved at startJob (store-bridge record), so a project that
		// moved between the panel's start and this attach fails with the
		// named reason instead of rendering a stale timeline.
		const stored = (await globals.opencutStore?.loadRecord(projectId)) ?? null;

		const assignment = await bridge.beginExport({
			jobId,
			request: snapshot.request,
			renderSpec: {
				width: project.settings.canvasSize.width,
				height: project.settings.canvasSize.height,
				fps,
				totalFrames,
			},
			projectContentDigest:
				stored === null ? undefined : await projectTimelineDigest(stored.record.data),
		});

		// -- the render loop (scene-exporter.runExport's math, byte-for-byte) --
		const frameBytes = assignment.width * assignment.height * 3;
		const framesPerBatch = Math.max(
			1,
			Math.min(BATCH_FRAME_LIMIT, Math.floor(BATCH_BYTES_LIMIT / frameBytes)),
		);
		const renderer = editor.renderer.createCanvasRenderer({
			width: assignment.width,
			height: assignment.height,
			fps: assignment.fps,
		});
		// The readout canvas (review B-1): the compositor's canvas backs a
		// wgpu surface — `getContext("2d")` on it is null by spec — so each
		// frame lands on THIS canvas via the donor's own `renderToCanvas`
		// (`drawImage` off the compositor canvas, the preview's proven path)
		// and the pixels are read here, on a context this window owns.
		const captureCanvas = document.createElement("canvas");
		captureCanvas.width = assignment.width;
		captureCanvas.height = assignment.height;
		const captureCtx = captureCanvas.getContext("2d", {
			willReadFrequently: true,
		});
		if (captureCtx === null) {
			await fail("export-renderer: no 2d context for the capture canvas");
			return;
		}
		const tracks = editor.scenes.getActiveScene().tracks;
		const mediaAssets = editor.media.getAssets();
		const scene = buildScene({
			tracks,
			mediaAssets,
			duration,
			canvasSize: project.settings.canvasSize,
			background: project.settings.background,
			assetResolver: editor.renderer.assetResolver,
		});

		let index = assignment.nextNeededFrame;
		let producerError: string | null = null;
		while (index < assignment.totalFrames) {
			const count = Math.min(framesPerBatch, assignment.totalFrames - index);
			const batch = new Uint8Array(count * frameBytes);
			try {
				for (let offset = 0; offset < count; offset += 1) {
					const frameIndex = index + offset;
					await renderer.renderToCanvas({
						node: scene,
						time: frameIndex * ticksPerFrame,
						targetCanvas: captureCanvas,
					});
					const image = captureCtx.getImageData(
						0,
						0,
						captureCanvas.width,
						captureCanvas.height,
					);
					const rgb = rgbaToRgb24({
						data: image.data,
						pixels: captureCanvas.width * captureCanvas.height,
					});
					batch.set(rgb, offset * frameBytes);
				}
			} catch (error) {
				producerError = errorText(error);
				break;
			}
			const ack = await sendBatchAwaitAck({
				jobId,
				startIndex: index,
				buffer: batch,
			});
			if (ack === null) {
				// The job settled mid-flight (cancel or named failure); the
				// settled event already told main, and it destroys us.
				break;
			}
			index += count;
		}

		if (producerError !== null) {
			await fail(producerError);
			return;
		}
		if (index < assignment.totalFrames) {
			// Settled early (cancelled/failed) — nothing further to send.
			return;
		}

		// -- audio, then the handoff to FFmpeg --------------------------------
		if (snapshot.request.includeAudio !== false) {
			const wavBlob = await extractTimelineAudio({
				tracks,
				mediaAssets,
				totalDuration: duration,
				resources: editor.resources,
			});
			await bridge.audio({ jobId, wav: await wavBlob.arrayBuffer() });
		}
		await bridge.finalize(jobId);
		// The encode runs in main; its settled event completes the wait (and
		// main destroys this window on it — jobDone is the belt-and-braces).
		await settledSignal;
		await bridge.jobDone(jobId);
	} finally {
		offJobEvent();
		offFrameAck();
	}
}

main().catch((error: unknown) => {
	console.error(`export-renderer: unhandled failure: ${errorText(error)}`);
});
