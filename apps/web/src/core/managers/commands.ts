import type { EditorCore } from "@/core";
import {
	BatchCommand,
	type Command,
	type CommandResult,
	type EditorCommandContext,
} from "@/commands";
import type {
	EditorSelectionPatch,
	EditorSelectionSnapshot,
} from "@/selection/editor-selection";
import { applyRippleAdjustments, computeRippleAdjustments } from "@/ripple";
import type { SceneTracks, TimelineTrack } from "@/timeline/types";
import { hasMediaId } from "@/timeline/element-utils";
import {
	assetCatalogFromMedia,
	classifyCommand,
	cloneOpenCutDraft,
	createDetachedCommandContext,
	diffOpenCutProjection,
	ensureDraftMarkerIds,
	projectOpenCutDraft,
	rebaseOpenCutHistoryDraft,
	type OpenCutProjectDraft,
} from "@/editor/transactions/opencut";
import { cloneOpaque } from "@/editor/persistence/opaque-value";

interface TransactionCommandHistoryEntry {
	readonly kind: "transaction";
	readonly undoTarget: OpenCutProjectDraft;
	readonly redoTarget: OpenCutProjectDraft;
	readonly forwardOperations: ReturnType<typeof diffOpenCutProjection>;
	readonly inverseOperations: ReturnType<typeof diffOpenCutProjection>;
	previousSelection: EditorSelectionSnapshot;
	readonly selectionPatch?: EditorSelectionPatch;
	selectionOverride?: EditorSelectionSnapshot;
}

interface ProviderPrivateHistoryEntry {
	readonly kind: "provider-private";
	readonly command: Command;
	previousSelection: EditorSelectionSnapshot;
	readonly selectionPatch?: EditorSelectionPatch;
	selectionOverride?: EditorSelectionSnapshot;
}

type CommandHistoryEntry =
	| TransactionCommandHistoryEntry
	| ProviderPrivateHistoryEntry;

type CommandReactor = (context: EditorCommandContext) => void;

interface PreparedCommandPayload {
	readonly undoTarget: OpenCutProjectDraft;
	readonly redoTarget: OpenCutProjectDraft;
	readonly result: CommandResult | undefined;
	readonly forwardOperations: ReturnType<typeof diffOpenCutProjection>;
	readonly inverseOperations: ReturnType<typeof diffOpenCutProjection>;
	readonly previousSelection: EditorSelectionSnapshot;
}

function activeTracks(draft: OpenCutProjectDraft): SceneTracks | null {
	return (
		draft.project.scenes.find(
			(scene) => scene.id === draft.project.currentSceneId,
		)?.tracks ?? null
	);
}

function historyUndoTarget({
	before,
	after,
	historylessProjectSettingKeys,
}: {
	before: OpenCutProjectDraft;
	after: OpenCutProjectDraft;
	historylessProjectSettingKeys: ReadonlySet<
		keyof OpenCutProjectDraft["project"]["settings"]
	>;
}): OpenCutProjectDraft {
	const target = cloneOpenCutDraft(before);
	for (const key of historylessProjectSettingKeys) {
		Object.assign(target.project.settings, {
			[key]: cloneOpaque(after.project.settings[key]),
		});
	}
	return target;
}

export class CommandManager {
	public isRippleEnabled = false;
	private history: CommandHistoryEntry[] = [];
	private redoStack: CommandHistoryEntry[] = [];
	private reactors: CommandReactor[] = [];
	private readonly context: EditorCommandContext;

	constructor(private editor: EditorCore) {
		this.context = { editor };
	}

	execute({ command }: { command: Command }): Promise<Command> {
		const routing = this.routingForRoot(command);
		if (routing === "immediate") {
			command.execute(this.context);
			return Promise.resolve(command);
		}
		if (routing === "provider-private") {
			const previousSelection = this.getSelectionSnapshot();
			const result = command.execute(this.context);
			const selectionOverride = this.applySelectionOverride(result);
			this.runReactors(this.context);
			this.history.push({
				kind: "provider-private",
				command,
				previousSelection,
				selectionPatch: result?.selection,
				selectionOverride,
			});
			this.redoStack = [];
			return Promise.resolve(command);
		}
		if (routing === "preview") {
			throw new Error("Preview commands must use local preview state");
		}
		return this.executeRouted({ command, recordHistory: true });
	}

	executeSystem({ command }: { command: Command }): Promise<Command> {
		if (this.routingForRoot(command) !== "transaction") {
			throw new Error(
				"System transaction execution requires transaction-routable work",
			);
		}
		return this.executeRouted({ command, recordHistory: false });
	}

	async removeMediaAssetReferences({
		assetId,
	}: {
		assetId: string;
	}): Promise<void> {
		await this.editor.transactions.commitUi({
			baseDraft: () => this.captureLiveDraft(),
			prepare: ({ draft, baseRevision, baseDocument }) => {
				draft.assetCatalog = draft.assetCatalog.filter(
					(asset) => asset.id !== assetId,
				);
				const scene = draft.project.scenes.find(
					(candidate) => candidate.id === draft.project.currentSceneId,
				);
				if (!scene) {
					throw new Error("The active scene is unavailable for media removal");
				}
				const withoutAsset = <Track extends TimelineTrack>(
					track: Track,
				): Track => ({
					...track,
					elements: track.elements.filter(
						(element) => !hasMediaId(element) || element.mediaId !== assetId,
					),
				});
				scene.tracks = {
					main: withoutAsset(scene.tracks.main),
					overlay: scene.tracks.overlay
						.map((track) => withoutAsset(track))
						.filter((track) => track.elements.length > 0),
					audio: scene.tracks.audio
						.map((track) => withoutAsset(track))
						.filter((track) => track.elements.length > 0),
				};
				const projected = projectOpenCutDraft(draft, {
					revision: baseRevision,
					idempotency: [],
				});
				return {
					draft,
					operations: diffOpenCutProjection({
						before: baseDocument,
						after: projected,
					}),
					payload: undefined,
				};
			},
		});
	}

	private executeRouted({
		command,
		recordHistory,
	}: {
		command: Command;
		recordHistory: boolean;
	}): Promise<Command> {
		const liveAssets = [...this.editor.media.getAssets()];
		const routed = this.editor.transactions
			.commitUi<PreparedCommandPayload>({
				baseDraft: () => this.captureLiveDraft(),
				prepare: ({ draft, baseRevision, baseDocument }) => {
					ensureDraftMarkerIds(draft);
					const before = cloneOpenCutDraft(draft);
					const previousSelection = this.getSelectionSnapshot();
					const beforeTracks = this.isRippleEnabled
						? cloneOpaque(activeTracks(draft))
						: null;
					const detached = createDetachedCommandContext({
						draft,
						assets: liveAssets,
					});
					const result = command.execute(detached.context);
					this.applyRippleToDraft({ beforeTracks, draft });
					this.runReactors(detached.context);
					ensureDraftMarkerIds(draft);
					const after = cloneOpenCutDraft(draft);
					const undoTarget = historyUndoTarget({
						before,
						after,
						historylessProjectSettingKeys:
							detached.historylessProjectSettingKeys,
					});
					const afterProjection = projectOpenCutDraft(after, {
						revision: baseRevision,
						idempotency: [],
					});
					const undoProjection = projectOpenCutDraft(undoTarget, {
						revision: baseRevision,
						idempotency: [],
					});
					const forwardOperations = diffOpenCutProjection({
						before: baseDocument,
						after: afterProjection,
					});
					const inverseOperations = diffOpenCutProjection({
						before: afterProjection,
						after: undoProjection,
					});
					return {
						draft: after,
						operations: forwardOperations,
						payload: {
							undoTarget,
							redoTarget: after,
							result,
							forwardOperations,
							inverseOperations,
							previousSelection,
						},
					};
				},
				finalize: ({ payload }) => {
					if (!recordHistory) return;
					const selectionOverride = this.applySelectionOverride(payload.result);
					this.history.push({
						kind: "transaction",
						undoTarget: payload.undoTarget,
						redoTarget: payload.redoTarget,
						forwardOperations: payload.forwardOperations,
						inverseOperations: payload.inverseOperations,
						previousSelection: payload.previousSelection,
						selectionPatch: payload.result?.selection,
						selectionOverride,
					});
					this.redoStack = [];
				},
			})
			.then(() => command)
			.catch((error) => {
				this.editor.reportPersistenceFailure({
					operation: "command-transaction",
					error,
				});
				throw error;
			});
		// Several UI entry points are intentionally fire-and-forget. Attach a
		// diagnostic observer while returning the original rejecting promise to
		// callers that explicitly await durable completion.
		void routed.catch(() => undefined);
		return routed;
	}

	executeWithoutHistory({
		command,
	}: {
		command: Command;
	}): CommandResult | undefined {
		const routing = this.routingForRoot(command);
		if (routing === "transaction" || routing === "preview") {
			throw new Error(
				"Transaction work cannot use executeWithoutHistory; use local preview and one final commit",
			);
		}
		return command.execute(this.context);
	}

	push({ command }: { command: Command }): void {
		if (this.routingForRoot(command) === "transaction") {
			throw new Error(
				"Transaction history is published only by a durable routed commit",
			);
		}
		this.history.push({
			kind: "provider-private",
			command,
			previousSelection: this.getSelectionSnapshot(),
		});
		this.redoStack = [];
	}

	registerReactor(reactor: CommandReactor): void {
		this.reactors.push(reactor);
	}

	async undo(): Promise<void> {
		const entry = this.history.at(-1);
		if (!entry) return;
		if (entry.kind === "provider-private") {
			entry.command.undo(this.context);
			this.history.pop();
			if (entry.selectionOverride !== undefined) {
				this.editor.selection.restoreSnapshot({
					snapshot: entry.previousSelection,
				});
			}
			this.redoStack.push(entry);
			return;
		}
		await this.commitHistorySnapshot({ entry, direction: "undo" });
	}

	async redo(): Promise<void> {
		const entry = this.redoStack.at(-1);
		if (!entry) return;
		if (entry.kind === "provider-private") {
			const previousSelection = this.getSelectionSnapshot();
			const result = entry.command.redo(this.context);
			const selectionOverride = this.applySelectionOverride(result);
			this.redoStack.pop();
			this.history.push({
				...entry,
				previousSelection,
				selectionPatch: result?.selection,
				selectionOverride,
			});
			return;
		}
		await this.commitHistorySnapshot({ entry, direction: "redo" });
	}

	canUndo(): boolean {
		return this.history.length > 0;
	}

	canRedo(): boolean {
		return this.redoStack.length > 0;
	}

	clear(): void {
		this.history = [];
		this.redoStack = [];
	}

	getHistoryCount(): number {
		return this.history.length;
	}

	private async commitHistorySnapshot({
		entry,
		direction,
	}: {
		entry: TransactionCommandHistoryEntry;
		direction: "undo" | "redo";
	}): Promise<void> {
		const from = direction === "undo" ? entry.redoTarget : entry.undoTarget;
		const to = direction === "undo" ? entry.undoTarget : entry.redoTarget;
		const previousSelection = this.getSelectionSnapshot();
		await this.editor.transactions.commitUi({
			baseDraft: () => this.captureLiveDraft(),
			prepare: ({ draft, baseRevision, baseDocument }) => {
				const rebased = rebaseOpenCutHistoryDraft({
					current: draft,
					from,
					to,
				});
				ensureDraftMarkerIds(rebased);
				const projected = projectOpenCutDraft(rebased, {
					revision: baseRevision,
					idempotency: [],
				});
				return {
					draft: rebased,
					operations: diffOpenCutProjection({
						before: baseDocument,
						after: projected,
					}),
					payload: undefined,
				};
			},
			finalize: () => {
				if (direction === "undo") {
					this.history.pop();
					if (entry.selectionOverride !== undefined) {
						this.editor.selection.restoreSnapshot({
							snapshot: entry.previousSelection,
						});
					}
					this.redoStack.push(entry);
					return;
				}
				this.redoStack.pop();
				const selectionOverride = entry.selectionPatch
					? this.editor.selection.applySelectionPatch({
							patch: entry.selectionPatch,
						})
					: undefined;
				this.history.push({
					...entry,
					previousSelection,
					selectionOverride,
				});
			},
		});
	}

	private captureLiveDraft(): OpenCutProjectDraft {
		const project = cloneOpaque(this.editor.project.getActive());
		project.scenes = cloneOpaque(this.editor.scenes.getScenes());
		const draft = {
			project,
			assetCatalog: assetCatalogFromMedia(this.editor.media.getAssets()),
		};
		ensureDraftMarkerIds(draft);
		return draft;
	}

	private routingForRoot(command: Command) {
		if (command instanceof BatchCommand) {
			const children = command.getCommands();
			if (children.length === 0)
				throw new Error("BatchCommand must not be empty");
			for (const child of children) {
				if (
					child instanceof BatchCommand ||
					classifyCommand(child) !== "transaction"
				) {
					throw new Error(
						"BatchCommand accepts only directly registered transaction children",
					);
				}
			}
			return "transaction" as const;
		}
		return classifyCommand(command);
	}

	private getSelectionSnapshot(): EditorSelectionSnapshot {
		return this.editor.selection.getSnapshot();
	}

	private applySelectionOverride(
		result: CommandResult | undefined,
	): EditorSelectionSnapshot | undefined {
		if (!result?.selection) return undefined;
		return this.editor.selection.applySelectionPatch({
			patch: result.selection,
		});
	}

	private runReactors(context: EditorCommandContext): void {
		for (const reactor of this.reactors) reactor(context);
	}

	private applyRippleToDraft({
		beforeTracks,
		draft,
	}: {
		beforeTracks: SceneTracks | null;
		draft: OpenCutProjectDraft;
	}): void {
		if (!this.isRippleEnabled || !beforeTracks) return;
		const afterTracks = activeTracks(draft);
		if (!afterTracks) return;
		const adjustments = computeRippleAdjustments({ beforeTracks, afterTracks });
		if (adjustments.length === 0) return;
		const tracksWithRipple = applyRippleAdjustments({
			tracks: afterTracks,
			adjustments,
		});
		const scene = draft.project.scenes.find(
			(candidate) => candidate.id === draft.project.currentSceneId,
		);
		if (scene) scene.tracks = tracksWithRipple;
	}
}
