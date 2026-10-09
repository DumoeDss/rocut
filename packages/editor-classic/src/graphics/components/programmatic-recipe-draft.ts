import type { MvRecipe, ProgrammaticSource } from "@opencut/editor-contracts";
import { sourceFingerprint } from "./programmatic-source-draft";

export function recipeReadOnlyReason(
	source: ProgrammaticSource,
): string | null {
	if (source.build)
		return "Compiled sources must be updated through their authoring workflow, not the recipe editor.";
	return source.recipe
		? null
		: "This source no longer contains a recipe. Your previous draft can be copied before Discard.";
}

/** JSON transport parsing only. Rust owns the recipe schema and all limits. */
export function parseRecipeDraft(text: string): MvRecipe {
	let value: MvRecipe;
	try {
		value = JSON.parse(text);
	} catch {
		throw Error("Recipe JSON is invalid. Fix the JSON before applying.");
	}
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw Error("Recipe JSON must be an object.");
	return value;
}

export interface RecipeDraftSnapshot {
	readonly baseline: ProgrammaticSource;
	readonly text: string;
	readonly dirty: boolean;
	readonly conflict: boolean;
	readonly pending: boolean;
	readonly error: string | null;
}

export class ProgrammaticRecipeDraft {
	private current: ProgrammaticSource;
	private state: RecipeDraftSnapshot;
	private listeners = new Set<() => void>();
	private retentionChanged: (() => void) | undefined;
	constructor(source: ProgrammaticSource) {
		this.current = source;
		this.state = this.clean(source);
	}
	private clean(source: ProgrammaticSource): RecipeDraftSnapshot {
		return {
			baseline: source,
			text: JSON.stringify(source.recipe ?? {}, null, 2),
			dirty: false,
			conflict: false,
			pending: false,
			error: null,
		};
	}
	setRetentionListener(listener: () => void) {
		this.retentionChanged = listener;
	}
	isRetained() {
		return this.listeners.size > 0 || this.state.dirty || this.state.pending;
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
	private publish(state: RecipeDraftSnapshot) {
		this.state = state;
		this.retentionChanged?.();
		for (const listener of this.listeners) listener();
	}
	refresh(source: ProgrammaticSource) {
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
	edit(text: string) {
		if (this.state.pending) return;
		this.publish({
			...this.state,
			text,
			dirty: text !== JSON.stringify(this.state.baseline.recipe ?? {}, null, 2),
			error: null,
		});
	}
	discard() {
		if (!this.state.pending) this.publish(this.clean(this.current));
	}
	async apply(
		commit: (snapshot: RecipeDraftSnapshot) => Promise<ProgrammaticSource>,
	) {
		const submitted = this.state;
		if (!submitted.dirty || submitted.pending || submitted.conflict) return;
		this.publish({ ...submitted, pending: true, error: null });
		try {
			const reason = recipeReadOnlyReason(this.current);
			if (reason) throw Error(reason);
			parseRecipeDraft(submitted.text);
			const result = await commit(submitted);
			if (
				sourceFingerprint(this.current) !==
					sourceFingerprint(submitted.baseline) &&
				sourceFingerprint(this.current) !== sourceFingerprint(result)
			) {
				this.publish({
					...this.state,
					pending: false,
					conflict: true,
					error:
						"The source changed while applying. Your draft is retained. Discard to load the current source.",
				});
				return;
			}
			this.current = result;
			this.publish(this.clean(result));
		} catch (error) {
			this.publish({
				...this.state,
				pending: false,
				error:
					error instanceof Error
						? error.message
						: "Recipe could not be applied.",
			});
		}
	}
}

// Session-local, clip-scoped retention mirrors the inline/build editors.
const drafts = new WeakMap<object, Map<string, ProgrammaticRecipeDraft>>();
export function getRecipeDraft({
	owner,
	key,
	source,
}: {
	owner: object;
	key: string;
	source: ProgrammaticSource;
}) {
	let session = drafts.get(owner);
	if (!session) {
		session = new Map();
		drafts.set(owner, session);
	}
	let draft = session.get(key);
	if (!draft) {
		draft = new ProgrammaticRecipeDraft(source);
		const cache = session,
			retained = draft;
		draft.setRetentionListener(() => {
			if (retained.isRetained()) cache.set(key, retained);
			else if (cache.get(key) === retained) cache.delete(key);
		});
	}
	return draft;
}
