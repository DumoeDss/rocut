import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import type { BuildDraftSnapshot } from "./programmatic-build-draft";
import { isAuthorTextFile } from "./programmatic-build-text";
import type { AuthorFileOperation } from "./programmatic-build-file-state";

export function ProgrammaticBuildFields({
	id,
	state,
	canLoad,
	canCompile,
	onSelect,
	onEdit,
	onRetry,
	onApply,
	onDiscard,
	onCancel,
	onFiles,
}: {
	id: string;
	state: BuildDraftSnapshot;
	canLoad: boolean;
	canCompile: boolean;
	onSelect: (id: string) => void;
	onEdit: (patch: { code?: string; inputProps?: string }) => void;
	onRetry: () => void;
	onApply: () => void;
	onDiscard: () => void;
	onCancel: () => void;
	onFiles: (operation: AuthorFileOperation) => void;
}) {
	const [path, setPath] = useState("");
	const build = state.baseline.build;
	if (!build) return null;
	const files = state.fileIds.filter(isAuthorTextFile).map((id) => ({ id }));
	const selected = state.files[state.selectedId];
	const busy = state.phase === "compiling" || state.phase === "saving";
	return (
		<div className="flex min-w-0 flex-col gap-3 text-sm">
			<p className="text-muted-foreground text-xs">
				Edit archived author files. Recompile and apply creates new attachments
				and updates only this clip. Original files stay unchanged.
			</p>
			<label htmlFor={`${id}-file`}>Author file</label>
			<select
				id={`${id}-file`}
				value={state.selectedId}
				disabled={busy || !canLoad}
				className="bg-background text-foreground border-input focus-visible:ring-ring h-8 min-w-0 rounded-md border px-2 text-xs focus-visible:ring-2"
				onChange={(event) => onSelect(event.target.value)}
			>
				{files.map((file) => (
					<option key={file.id} value={file.id}>
						{file.id}
						{state.files[file.id]?.code !== undefined &&
						state.files[file.id].code !== state.files[file.id].original
							? " (edited)"
							: ""}
					</option>
				))}
			</select>
			<p className="text-muted-foreground text-xs">
				{files.length} text files; {state.fileIds.length - files.length} binary
				files retained in the archive.
			</p>
			<p className="text-muted-foreground text-xs">
				Entry file: {state.entryFile}
			</p>
			<label htmlFor={`${id}-path`}>New source path</label>
			<Input
				id={`${id}-path`}
				value={path}
				onChange={(event) => setPath(event.target.value)}
				placeholder="src/scene.tsx"
				disabled={busy || state.conflict || !canCompile}
			/>
			<div className="flex flex-wrap gap-2">
				<Button
					size="sm"
					variant="outline"
					disabled={busy || state.conflict || !canCompile || !path}
					onClick={() => onFiles({ op: "add", id: path })}
				>
					Add file
				</Button>
				<Button
					size="sm"
					variant="outline"
					disabled={busy || state.conflict || !canCompile || !path || !selected}
					onClick={() => onFiles({ op: "rename", id: path })}
				>
					Rename file
				</Button>
				<Button
					size="sm"
					variant="outline"
					disabled={
						busy ||
						state.conflict ||
						!canCompile ||
						state.selectedId === state.entryFile
					}
					onClick={() => onFiles({ op: "delete" })}
				>
					Delete file
				</Button>
			</div>
			{selected && (
				<>
					<label htmlFor={`${id}-code`}>Author code</label>
					<Textarea
						id={`${id}-code`}
						value={selected.code}
						readOnly={busy || state.conflict}
						onChange={(event) => onEdit({ code: event.target.value })}
						spellCheck={false}
						wrap="off"
						className="h-64 resize-y font-mono text-xs md:text-xs"
						aria-describedby={`${id}-status`}
					/>
				</>
			)}
			{build.engine !== "hyperframes" && (
				<>
					<label htmlFor={`${id}-props`}>Input props (JSON)</label>
					<Textarea
						id={`${id}-props`}
						value={state.inputProps}
						readOnly={busy || state.conflict}
						onChange={(event) => onEdit({ inputProps: event.target.value })}
						spellCheck={false}
						className="h-28 resize-y font-mono text-xs md:text-xs"
					/>
				</>
			)}
			{!canLoad && (
				<p className="text-muted-foreground text-xs">
					This host cannot read archived author files.
				</p>
			)}
			{!canCompile && (
				<p className="text-muted-foreground text-xs">
					This host has no archived-source compiler bridge. You can select and
					copy any loaded text.
				</p>
			)}
			{state.conflict && (
				<p className="text-destructive text-xs" role="alert">
					The source changed outside this draft. Your edits are retained; copy
					them before Discard loads the current source.
				</p>
			)}
			{state.error && (
				<p className="text-destructive break-words text-xs" role="alert">
					{state.error}
				</p>
			)}
			<p
				id={`${id}-status`}
				className="text-muted-foreground text-xs"
				role="status"
			>
				{state.phase === "loading"
					? "Loading author file..."
					: state.phase === "compiling"
						? "Recompiling archived source..."
						: state.phase === "saving"
							? "Saving rebuilt source..."
							: state.dirty
								? "Unapplied author draft"
								: "Author source is up to date"}
			</p>
			<div className="flex flex-wrap justify-end gap-2">
				{!selected && canLoad && !state.phase && !state.conflict && (
					<Button size="sm" variant="outline" onClick={onRetry}>
						Load file
					</Button>
				)}
				{state.phase && state.phase !== "saving" && (
					<Button size="sm" variant="outline" onClick={onCancel}>
						Cancel
					</Button>
				)}
				<Button
					size="sm"
					variant="outline"
					disabled={busy || (!state.dirty && !state.conflict)}
					onClick={onDiscard}
				>
					Discard
				</Button>
				<Button
					size="sm"
					disabled={
						!canCompile || !state.dirty || !!state.phase || state.conflict
					}
					onClick={onApply}
				>
					Recompile and apply
				</Button>
			</div>
		</div>
	);
}
