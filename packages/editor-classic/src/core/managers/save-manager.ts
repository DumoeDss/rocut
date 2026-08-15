import type { EditorCore } from "..";
import type { TimerHandle } from "../../editor/session/resources";

type SaveManagerOptions = {
	debounceMs?: number;
};

export class SaveManager {
	private debounceMs: number;
	private isPaused = false;
	private isSaving = false;
	private hasPendingSave = false;
	private saveTimer: TimerHandle | null = null;
	private unsubscribeHandlers: Array<() => void> = [];
	private publicationListeners = new Set<() => void>();
	private alreadyDurablePublicationDepth = 0;

	constructor({
		editor,
		debounceMs = 800,
	}: {
		editor: EditorCore;
	} & SaveManagerOptions) {
		this.editor = editor;
		this.debounceMs = debounceMs;
	}

	private editor: EditorCore;

	start(): void {
		if (this.unsubscribeHandlers.length > 0) return;

		this.unsubscribeHandlers = [
			this.editor.scenes.subscribe(() => {
				this.markDirty();
			}),
			this.editor.timeline.subscribe(() => {
				this.markDirty();
			}),
		];
	}

	stop(): void {
		for (const unsubscribe of this.unsubscribeHandlers) {
			unsubscribe();
		}
		this.unsubscribeHandlers = [];
		this.clearTimer();
	}

	pause(): void {
		this.clearTimer();
		this.isPaused = true;
	}

	resume(): void {
		this.isPaused = false;
		if (this.hasPendingSave) {
			this.queueSave();
		}
	}

	markDirty({ force = false }: { force?: boolean } = {}): void {
		if (this.alreadyDurablePublicationDepth > 0) return;
		if (this.isPaused && !force) return;
		this.hasPendingSave = true;
		this.queueSave();
	}

	publishAlreadyDurable<Result>(operation: () => Result): Result {
		this.alreadyDurablePublicationDepth += 1;
		try {
			return operation();
		} finally {
			this.alreadyDurablePublicationDepth -= 1;
		}
	}

	async flush(): Promise<void> {
		this.hasPendingSave = true;
		await this.saveNow();
	}

	getIsDirty(): boolean {
		return this.hasPendingSave || this.isSaving;
	}

	/** Observe successful durable-save publications (used by lifecycle probes). */
	observePublications(listener: () => void): () => void {
		this.publicationListeners.add(listener);
		return () => {
			this.publicationListeners.delete(listener);
		};
	}

	private queueSave(): void {
		if (this.isPaused) return;
		if (this.isSaving) return;
		if (this.saveTimer) {
			this.saveTimer.cancel();
		}
		// Focused persistence harnesses may provide only the ProjectManager
		// collaborator. Production EditorCore instances always have the session
		// resource registry; this microtask fallback keeps those narrow harnesses
		// observable without reintroducing a direct platform timer here.
		if (!this.editor.resources) {
			queueMicrotask(() => {
				void this.saveNow().catch(() => {
					// Keep the pending flag set for an explicit retry.
				});
			});
			return;
		}
		this.saveTimer = this.editor.resources.setTimeout({
			handler: () => {
				this.saveTimer = null;
				void this.saveNow().catch(() => {
					// ProjectManager already reports the durable failure and keeps the
					// pending flag set for an explicit retry.
				});
			},
			ms: this.debounceMs,
		});
	}

	private async saveNow(): Promise<void> {
		if (this.isPaused) return;
		if (this.isSaving) return;
		if (!this.hasPendingSave) return;

		const activeProject = this.editor.project.getActive();
		if (!activeProject) return;
		if (this.editor.project.getIsLoading()) return;
		if (this.editor.project.getMigrationState().isMigrating) return;

		this.isSaving = true;
		this.hasPendingSave = false;
		this.clearTimer();
		let didFail = false;

		try {
			await this.editor.project.saveCurrentProject();
			for (const listener of this.publicationListeners) {
				try {
					listener();
				} catch {
					// Observers are diagnostics only and must never make a durable save
					// appear to have failed.
				}
			}
		} catch (error) {
			didFail = true;
			this.hasPendingSave = true;
			throw error;
		} finally {
			this.isSaving = false;
			if (this.hasPendingSave && !didFail && !this.isPaused) {
				this.queueSave();
			}
		}
	}

	private clearTimer(): void {
		if (!this.saveTimer) return;
		this.saveTimer.cancel();
		this.saveTimer = null;
	}
}
