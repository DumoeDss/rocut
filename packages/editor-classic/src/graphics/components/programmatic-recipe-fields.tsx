import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";
import type { RecipeDraftSnapshot } from "./programmatic-recipe-draft";

export function ProgrammaticRecipeFields({
	id,
	state,
	readOnly,
	conflict,
	onEdit,
	onApply,
	onDiscard,
}: {
	id: string;
	state: RecipeDraftSnapshot;
	readOnly: string | null;
	conflict: boolean;
	onEdit: (text: string) => void;
	onApply: () => void;
	onDiscard: () => void;
}) {
	return (
		<div className="flex min-w-0 flex-col gap-3 text-sm">
			<p className="text-muted-foreground text-xs">
				Edit the complete recipe JSON: scenes, settings, post effects, amounts
				and audio bindings. Resources and source provenance are preserved. Rust
				validates the recipe on Apply.
			</p>
			{readOnly && (
				<p className="text-muted-foreground break-words text-xs">
					{readOnly} You can select and copy your draft.
				</p>
			)}
			<label htmlFor={`${id}-recipe`}>
				{readOnly
					? "Previous recipe draft (read-only)"
					: "Recipe JSON (advanced)"}
			</label>
			<Textarea
				id={`${id}-recipe`}
				value={state.text}
				readOnly={!!readOnly}
				disabled={state.pending}
				onChange={(event) => onEdit(event.target.value)}
				spellCheck={false}
				wrap="off"
				className="h-64 resize-y font-mono text-xs md:text-xs"
				aria-describedby={`${id}-recipe-status`}
				aria-invalid={!!state.error}
			/>
			{conflict && state.dirty && (
				<p className="text-destructive text-xs" role="alert">
					The source changed outside this draft. Your edits are retained.
					Discard to load the current recipe before editing again.
				</p>
			)}
			{state.error && (
				<p className="text-destructive break-words text-xs" role="alert">
					{state.error}
				</p>
			)}
			<p
				id={`${id}-recipe-status`}
				className="text-muted-foreground text-xs"
				role="status"
			>
				{state.pending
					? "Applying recipe..."
					: state.dirty
						? "Unapplied recipe draft"
						: "Recipe is up to date"}
			</p>
			<div className="flex justify-end gap-2">
				<Button
					variant="outline"
					size="sm"
					aria-label="Discard recipe draft"
					disabled={state.pending || (!state.dirty && !conflict)}
					onClick={onDiscard}
				>
					Discard
				</Button>
				<Button
					size="sm"
					aria-label="Apply recipe"
					disabled={!!readOnly || !state.dirty || state.pending || conflict}
					onClick={onApply}
				>
					Apply
				</Button>
			</div>
		</div>
	);
}
