import type { ProgrammaticSource } from "@opencut/editor-contracts";

export function sourceReadOnlyReason(
	source: ProgrammaticSource,
): string | null {
	if (source.build) {
		if (source.build.engine === "three")
			return "This compiled Three source uses the Agent programmatic/build/compile or programmatic/build/rebuild workflow. Archived author editing in this panel is available for HyperFrames and Remotion.";
		return "The generated HTML is read-only. Edit its archived author files below, then recompile to update this clip.";
	}
	if (source.recipe) {
		return "This source is an MV recipe, not inline code. Update editing.programmatic.recipe through the Agent transaction entry, preserving the source resources. This panel does not edit recipes.";
	}
	if (source.documentId) {
		return "The HTML lives in a content-addressed document attachment. Import the updated HTML with the Agent host's programmatic/resources/import endpoint, then replace editing.programmatic with its documentId and resources. This panel does not overwrite attachments.";
	}
	return null;
}

export function sourceFingerprint(source: ProgrammaticSource): string {
	return JSON.stringify(source);
}

export interface SourceDraftSnapshot {
	readonly baseline: ProgrammaticSource;
	readonly code: string;
	readonly seed: string;
	readonly dirty: boolean;
	readonly conflict: boolean;
	readonly pending: boolean;
	readonly error: string | null;
}

/** UI-only draft state. Source limits and persistence stay in Rust/transactions. */
export class ProgrammaticSourceDraft {
	private current: ProgrammaticSource;
	private state: SourceDraftSnapshot;
	private listeners = new Set<() => void>();
	private retentionChanged: (() => void) | undefined;

	setRetentionListener(listener: () => void): void {
		this.retentionChanged = listener;
	}

	isRetained(): boolean {
		return this.listeners.size > 0 || this.state.dirty || this.state.pending;
	}

	constructor(source: ProgrammaticSource) {
		this.current = source;
		this.state = this.clean(source);
	}

	private clean(source: ProgrammaticSource): SourceDraftSnapshot {
		return {
			baseline: source,
			code: source.code,
			seed: String(source.seed),
			dirty: false,
			conflict: false,
			pending: false,
			error: null,
		};
	}

	getSnapshot = (): SourceDraftSnapshot => this.state;
	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		this.retentionChanged?.();
		return () => {
			this.listeners.delete(listener);
			this.retentionChanged?.();
		};
	};

	private publish(state: SourceDraftSnapshot): void {
		this.state = state;
		this.retentionChanged?.();
		for (const listener of this.listeners) listener();
	}

	refresh(source: ProgrammaticSource): void {
		if (sourceFingerprint(source) === sourceFingerprint(this.current)) return;
		this.current = source;
		this.publish(
			this.state.dirty || this.state.pending
				? {
						...this.state,
						conflict:
							sourceFingerprint(source) !==
							sourceFingerprint(this.state.baseline),
					}
				: this.clean(source),
		);
	}

	edit(patch: { code?: string; seed?: string }): void {
		if (this.state.pending) return;
		const next = { ...this.state, ...patch, error: null };
		next.dirty =
			next.code !== next.baseline.code ||
			next.seed !== String(next.baseline.seed);
		this.publish(next);
	}

	discard(): void {
		if (!this.state.pending) this.publish(this.clean(this.current));
	}

	async apply(
		commit: (snapshot: SourceDraftSnapshot) => Promise<ProgrammaticSource>,
	): Promise<void> {
		const submitted = this.state;
		if (!submitted.dirty || submitted.pending || submitted.conflict) return;
		this.publish({ ...submitted, pending: true, error: null });
		try {
			const result = await commit(submitted);
			// A late completion must not replace a newer externally published source.
			if (
				sourceFingerprint(this.current) ===
				sourceFingerprint(submitted.baseline)
			) {
				this.current = result;
			}
			this.publish(this.clean(this.current));
		} catch (error) {
			this.publish({
				...this.state,
				pending: false,
				error:
					error instanceof Error
						? error.message
						: "Source could not be applied.",
			});
		}
	}
}

// Unsaved drafts survive selection changes, but never cross editor sessions.
const drafts = new WeakMap<object, Map<string, ProgrammaticSourceDraft>>();
export function getSourceDraft({
	owner,
	key,
	source,
}: {
	owner: object;
	key: string;
	source: ProgrammaticSource;
}): ProgrammaticSourceDraft {
	let session = drafts.get(owner);
	if (!session) {
		session = new Map();
		drafts.set(owner, session);
	}
	let draft = session.get(key);
	if (!draft) {
		draft = new ProgrammaticSourceDraft(source);
		const cache = session;
		const retained = draft;
		draft.setRetentionListener(() => {
			if (retained.isRetained()) cache.set(key, retained);
			else if (cache.get(key) === retained) cache.delete(key);
		});
	}
	return draft;
}
