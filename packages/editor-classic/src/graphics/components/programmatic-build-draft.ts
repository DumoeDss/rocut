import type { ProgrammaticSource } from "@opencut/editor-contracts";
import type { ProgrammaticFrameProvider } from "@opencut/editor-ports/host";
import { sourceFingerprint } from "./programmatic-source-draft";
import { isAuthorTextFile, loadAuthorText } from "./programmatic-build-text";
import {
	cleanBuildDraft,
	editBuildDraft,
	failedBuildDraft,
	type BuildDraftSnapshot,
} from "./programmatic-build-draft-state";
import { compileBuildDraft } from "./programmatic-build-draft-operations";
import { getCachedBuildDraft } from "./programmatic-build-draft-cache";
import {
	changeBuildFiles,
	type AuthorFileOperation,
} from "./programmatic-build-file-state";
export type { BuildDraftSnapshot } from "./programmatic-build-draft-state";

/** UI drafts only. Compilation/admission belongs to the Host and Rust. */
export class ProgrammaticBuildDraft {
	private current: ProgrammaticSource;
	private state: BuildDraftSnapshot;
	private controller?: AbortController;
	private listeners = new Set<() => void>();
	private retentionChanged?: () => void;
	constructor(source: ProgrammaticSource) {
		this.current = source;
		this.state = cleanBuildDraft({ source });
	}
	setRetentionListener(listener: () => void) {
		this.retentionChanged = listener;
	}
	isRetained() {
		return this.listeners.size > 0 || this.state.dirty || !!this.state.phase;
	}
	getSnapshot = () => this.state;
	subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		this.retentionChanged?.();
		return () => {
			this.listeners.delete(listener);
			this.retentionChanged?.();
		};
	};
	private publish(state: BuildDraftSnapshot) {
		this.state = state;
		this.retentionChanged?.();
		for (const listener of this.listeners) listener();
	}
	refresh(source: ProgrammaticSource) {
		if (sourceFingerprint(source) === sourceFingerprint(this.current)) return;
		this.current = source;
		if (
			this.state.dirty ||
			this.state.phase === "saving" ||
			this.state.phase === "compiling"
		) {
			this.publish({
				...this.state,
				conflict:
					sourceFingerprint(source) !== sourceFingerprint(this.state.baseline),
			});
		} else {
			this.cancel();
			this.publish(
				cleanBuildDraft({ source, selectedId: this.state.selectedId }),
			);
		}
	}
	select(id: string) {
		if (!this.state.fileIds.includes(id)) return;
		if (this.state.phase === "compiling" || this.state.phase === "saving")
			return;
		this.cancel();
		this.publish({ ...this.state, selectedId: id, error: null });
	}
	edit(patch: { code?: string; inputProps?: string }) {
		const next = editBuildDraft({ state: this.state, patch });
		if (next !== this.state) this.publish(next);
	}
	changeFiles(operation: AuthorFileOperation) {
		if (
			this.state.phase === "compiling" ||
			this.state.phase === "saving" ||
			this.state.conflict
		)
			return;
		this.cancel();
		try {
			this.publish(changeBuildFiles(this.state, operation));
		} catch (error) {
			this.publish(failedBuildDraft({ state: this.state, error }));
		}
	}
	discard() {
		if (this.state.phase === "saving") return;
		this.cancel();
		this.publish(
			cleanBuildDraft({
				source: this.current,
				selectedId: this.state.selectedId,
			}),
		);
	}
	cancel() {
		// Once the serialized transaction starts, its durable result owns state.
		if (this.state.phase === "saving") return;
		this.controller?.abort(Error("Author operation cancelled"));
		this.controller = undefined;
		if (this.state.phase) this.publish({ ...this.state, phase: null });
	}
	async load(provider?: ProgrammaticFrameProvider) {
		const submitted = this.state;
		if (
			!submitted.fileIds.includes(submitted.selectedId) ||
			submitted.files[submitted.selectedId] ||
			submitted.conflict ||
			submitted.phase
		)
			return;
		if (!isAuthorTextFile(submitted.selectedId)) return;
		const controller = new AbortController();
		this.controller = controller;
		this.publish({ ...submitted, phase: "loading", error: null });
		try {
			const code = await loadAuthorText({
				source: submitted.baseline,
				id: submitted.selectedId,
				provider,
				signal: controller.signal,
			});
			controller.signal.throwIfAborted();
			if (this.controller !== controller) return;
			this.publish({
				...this.state,
				phase: null,
				files: {
					...this.state.files,
					[submitted.selectedId]: { original: code, code },
				},
			});
		} catch (error) {
			this.failed({ controller, error });
		} finally {
			if (this.controller === controller) this.controller = undefined;
		}
	}
	private failed({
		controller,
		error,
	}: {
		controller: AbortController;
		error: unknown;
	}) {
		if (this.controller !== controller) return;
		this.publish(failedBuildDraft({ state: this.state, error }));
	}
	async apply({
		provider,
		commit,
	}: {
		provider?: ProgrammaticFrameProvider;
		commit: (
			baseline: ProgrammaticSource,
			replacement: ProgrammaticSource,
		) => Promise<void>;
	}) {
		const submitted = this.state;
		if (!submitted.dirty || submitted.conflict || submitted.phase) return;
		const controller = new AbortController();
		this.controller = controller;
		this.publish({ ...submitted, phase: "compiling", error: null });
		try {
			const replacement = await compileBuildDraft({
				submitted,
				provider,
				signal: controller.signal,
			});
			controller.signal.throwIfAborted();
			if (
				sourceFingerprint(this.current) !==
				sourceFingerprint(submitted.baseline)
			)
				throw Error(
					"The source changed during compilation. Your draft is retained.",
				);
			this.publish({ ...this.state, phase: "saving" });
			await commit(submitted.baseline, replacement);
			if (
				sourceFingerprint(this.current) ===
				sourceFingerprint(submitted.baseline)
			)
				this.current = replacement;
			this.publish(
				cleanBuildDraft({
					source: this.current,
					selectedId: submitted.selectedId,
				}),
			);
		} catch (error) {
			this.failed({ controller, error });
		} finally {
			if (this.controller === controller) this.controller = undefined;
		}
	}
}

export function getBuildDraft({
	owner,
	key,
	source,
}: {
	owner: object;
	key: string;
	source: ProgrammaticSource;
}) {
	return getCachedBuildDraft({
		owner,
		key,
		create: () => new ProgrammaticBuildDraft(source),
	});
}
