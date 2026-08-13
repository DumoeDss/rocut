import { PlaybackManager } from "./managers/playback-manager";
import { TimelineManager } from "./managers/timeline-manager";
import { ScenesManager } from "./managers/scenes-manager";
import { ProjectManager } from "./managers/project-manager";
import { MediaManager } from "./managers/media-manager";
import { RendererManager } from "./managers/renderer-manager";
import { CommandManager } from "./managers/commands";
import { SaveManager } from "./managers/save-manager";
import { AudioManager } from "./managers/audio-manager";
import { SelectionManager } from "./managers/selection-manager";
import { ClipboardManager } from "./managers/clipboard-manager";
import { DiagnosticsManager } from "./managers/diagnostics-manager";
import { registerTranscriptionDiagnostics } from "@/transcription/diagnostics";
import {
	createTranscriptionService,
	type TranscriptionService,
} from "@/services/transcription/service";
import type { EditorSession } from "@/editor/session/session-types";
import { SessionPersistenceCoordinator } from "@/editor/persistence";
import { ProjectStoreError } from "@/editor/ports";
import type { AssetResolver } from "@/editor/ports";
import type { SessionResources } from "@/editor/session/resources";
import { SessionOpenCutTransactions } from "@/editor/transactions/opencut";

function throwSettledErrors({
	results,
	message,
}: {
	results: PromiseSettledResult<unknown>[];
	message: string;
}): void {
	const errors = results.flatMap((result) =>
		result.status === "rejected" ? [result.reason] : [],
	);
	if (errors.length === 1) throw errors[0];
	if (errors.length > 1) throw new AggregateError(errors, message);
}

export class EditorCore {
	public readonly timeline: TimelineManager;
	public readonly command: CommandManager;
	public readonly playback: PlaybackManager;
	public readonly scenes: ScenesManager;
	public readonly project: ProjectManager;
	public readonly media: MediaManager;
	public readonly renderer: RendererManager;
	public readonly save: SaveManager;
	public readonly audio: AudioManager;
	public readonly selection: SelectionManager;
	public readonly clipboard: ClipboardManager;
	public readonly diagnostics: DiagnosticsManager;
	public readonly transcription: TranscriptionService;
	public readonly persistence: SessionPersistenceCoordinator;
	public readonly resources: SessionResources;
	public readonly transactions: SessionOpenCutTransactions;
	private readonly sessionDiagnostics: EditorSession["diagnostics"];
	private readonly hostAssets: AssetResolver;

	private constructor(session: EditorSession) {
		this.sessionDiagnostics = session.diagnostics;
		this.resources = session.resources;
		this.hostAssets = session.host.assets;
		this.persistence = new SessionPersistenceCoordinator(session.host.store);
		this.command = new CommandManager(this);
		this.timeline = new TimelineManager(this);
		this.playback = new PlaybackManager(this);
		this.scenes = new ScenesManager(this);
		this.project = new ProjectManager(this);
		this.media = new MediaManager(this);
		this.renderer = new RendererManager({
			editor: this,
			resources: this.resources,
			assetResolver: session.host.assets,
			videoCache: this.media.getVideoCache(),
		});
		this.save = new SaveManager({ editor: this });
		this.audio = new AudioManager(this);
		this.selection = new SelectionManager(this);
		this.clipboard = new ClipboardManager(this);
		this.diagnostics = new DiagnosticsManager(this);
		this.transactions = new SessionOpenCutTransactions({
			persistence: this.persistence,
			arbiter: this.persistence.projectMutationArbiter,
			publish: (draft) => {
				this.save.publishAlreadyDurable(() => {
					this.project.adoptCommittedProject({ project: draft.project });
					this.scenes.adoptCommittedScenes({
						scenes: draft.project.scenes,
						currentSceneId: draft.project.currentSceneId,
					});
				});
			},
		});
		const lifecycleResources = this.resources as SessionResources & {
			isActivityAdmitted?: () => boolean;
		};
		this.transcription = createTranscriptionService({
			resources: this.resources,
			activityAdmission: () =>
				lifecycleResources.isActivityAdmitted?.() ?? true,
		});
		registerTranscriptionDiagnostics({ diagnostics: this.diagnostics });
		this.playback.bindTimelineScope();
		this.command.registerReactor(({ editor }) => {
			const activeScene = editor.scenes.getActiveSceneOrNull();
			if (!activeScene) {
				return;
			}

			const tracks = activeScene.tracks;
			const prunedTracks = {
				...tracks,
				overlay: tracks.overlay.filter((track) => track.elements.length > 0),
				audio: tracks.audio.filter((track) => track.elements.length > 0),
			};
			if (
				prunedTracks.overlay.length !== tracks.overlay.length ||
				prunedTracks.audio.length !== tracks.audio.length
			) {
				editor.timeline.updateTracks(prunedTracks);
			}
		});
		this.save.start();
	}

	reportPersistenceFailure({
		operation,
		error,
	}: {
		operation: string;
		error: unknown;
	}): void {
		this.sessionDiagnostics.log({
			record: {
				level: "error",
				message: "Durable editor operation failed",
				context: {
					operation,
					code: error instanceof ProjectStoreError ? error.code : "unknown",
				},
			},
		});
	}

	static createSessionOwned({
		session,
	}: {
		session: EditorSession;
	}): EditorCore {
		return new EditorCore(session);
	}

	async drainProjectLiveState(): Promise<void> {
		const results = await Promise.allSettled([
			Promise.resolve().then(() => this.playback.pause()),
			Promise.resolve().then(() => this.audio.suspend()),
			Promise.resolve().then(() => this.media.clearAllAssets()),
			Promise.resolve().then(() => this.renderer.drainProjectLiveState()),
			Promise.resolve().then(() => this.transcription.terminate()),
		]);
		throwSettledErrors({
			results,
			message: "Failed to drain the previous project's live state.",
		});
	}

	async suspend(): Promise<void> {
		const results = await Promise.allSettled([
			Promise.resolve().then(() => this.save.pause()),
			Promise.resolve().then(() => this.playback.suspend()),
			Promise.resolve().then(() => this.audio.suspend()),
			Promise.resolve().then(() => this.renderer.suspend()),
			Promise.resolve().then(() => this.transcription.terminate()),
		]);
		throwSettledErrors({
			results,
			message: "Failed to suspend editor activity.",
		});
	}

	async prepareActivityResume(): Promise<void> {
		const results = await Promise.allSettled([
			Promise.resolve().then(() => this.audio.resume()),
			Promise.resolve().then(() => this.renderer.resume()),
		]);
		throwSettledErrors({
			results,
			message: "Failed to prepare editor activity for resume.",
		});
	}

	async resume(): Promise<void> {
		const results = await Promise.allSettled([
			Promise.resolve().then(() => this.save.resume()),
			Promise.resolve().then(() => this.playback.resume()),
		]);
		throwSettledErrors({
			results,
			message: "Failed to resume editor activity.",
		});
	}

	async dispose(): Promise<void> {
		const errors: unknown[] = [];
		const attempt = async (operation: () => void | Promise<void>) => {
			try {
				await operation();
			} catch (error) {
				errors.push(error);
			}
		};

		await attempt(() => this.save.stop());
		await attempt(() => this.playback.dispose());
		await attempt(() => this.renderer.dispose());
		// Cache teardown is asynchronous: wait for in-flight decode/iterator work
		// before the session resource registry closes its platform handles.
		await attempt(() => this.media.dispose());
		await attempt(() => this.transcription.terminate());
		await attempt(() => this.audio.dispose());
		await attempt(() => this.transactions.dispose());
		await attempt(() => this.persistence.destroy());

		if (errors.length === 1) throw errors[0];
		if (errors.length > 1) {
			throw new AggregateError(errors, "Failed to dispose editor core.");
		}
	}
}
