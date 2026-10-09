import type { ProgrammaticSource } from "@opencut/editor-contracts";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import type { SourceDraftSnapshot } from "./programmatic-source-draft";

export function ProgrammaticSourceFields({
	id,
	runtime,
	state,
	readOnly,
	onEdit,
}: {
	id: string;
	runtime: ProgrammaticSource["runtime"];
	state: SourceDraftSnapshot;
	readOnly: string | null;
	onEdit: (patch: { code?: string; seed?: string }) => void;
}) {
	return (
		<>
			{readOnly && (
				<p className="text-muted-foreground break-words">{readOnly}</p>
			)}
			{(!readOnly || state.dirty) && (
				<>
					<p className="text-muted-foreground text-xs">
						{readOnly
							? "This unapplied draft belongs to the previous inline source. You can select and copy it before Discard. It cannot be applied to the current source."
							: "Edits stay in this draft until Apply. Source validation runs on Apply; code executes in the isolated preview."}
					</p>
					<label htmlFor={`${id}-code`}>
						{readOnly
							? "Previous inline draft (read-only)"
							: runtime === "canvas-worker"
								? "Canvas code"
								: "HTML document"}
					</label>
					<Textarea
						id={`${id}-code`}
						value={state.code}
						readOnly={!!readOnly}
						disabled={state.pending}
						onChange={(event) => onEdit({ code: event.target.value })}
						spellCheck={false}
						wrap="off"
						className="h-64 resize-y font-mono text-xs md:text-xs"
						aria-describedby={`${id}-status`}
					/>
					<label htmlFor={`${id}-seed`}>
						{readOnly ? "Draft seed (read-only)" : "Seed"}
					</label>
					<Input
						id={`${id}-seed`}
						value={state.seed}
						readOnly={!!readOnly}
						disabled={state.pending}
						inputMode="numeric"
						size="sm"
						onChange={(event) => onEdit({ seed: event.target.value })}
					/>
				</>
			)}
		</>
	);
}
