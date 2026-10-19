"use client";

import { useState, useSyncExternalStore } from "react";
import { Button } from "../ui/button";
import { useEditorInstance } from "../../editor/use-editor";
import { useEditorMessages } from "../../editor/host/editor-host-context";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { SettingsView } from "./panels/assets/views/settings";

export function ProjectOperations() {
	const editor = useEditorInstance();
	const messages = useEditorMessages();
	const { canUndo, canRedo } = useSyncExternalStore(
		editor.command.subscribe,
		editor.command.getHistorySnapshot,
		editor.command.getHistorySnapshot,
	);
	const save = useSyncExternalStore(
		editor.save.subscribe,
		editor.save.getState,
		editor.save.getState,
	);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [operationError, setOperationError] = useState<string | null>(null);
	const error = save.error ?? operationError;
	const state = save.isSaving
		? "saving"
		: save.isReadOnly
			? "readonly"
			: save.error
				? "failed"
				: save.isPaused
					? "paused"
					: save.isDirty
						? "dirty"
						: "saved";
	const saveLabel = save.isSaving
		? messages.saving
		: save.isReadOnly
			? messages.readonly
			: save.error
				? messages.retry
				: save.isPaused
					? messages.paused
					: save.isDirty
						? messages.dirty
						: messages.saved;
	return (
		<div
			className="flex min-w-0 items-center gap-1"
			aria-label={messages.operations}
			data-testid="project-operations"
		>
			<Button
				size="sm"
				variant="ghost"
				disabled={!canUndo}
				onClick={() =>
					void editor.command
						.undo()
						.catch((failure: unknown) =>
							setOperationError(
								failure instanceof Error
									? failure.message
									: messages.undoFailed,
							),
						)
				}
				title={`${messages.undo} (Ctrl+Z)`}
			>
				{messages.undo}
			</Button>
			<Button
				size="sm"
				variant="ghost"
				disabled={!canRedo}
				onClick={() =>
					void editor.command
						.redo()
						.catch((failure: unknown) =>
							setOperationError(
								failure instanceof Error
									? failure.message
									: messages.redoFailed,
							),
						)
				}
				title={`${messages.redo} (Ctrl+Shift+Z)`}
			>
				{messages.redo}
			</Button>
			<Button
				size="sm"
				variant="ghost"
				data-testid="project-save"
				data-save-state={state}
				disabled={save.isSaving || save.isPaused}
				title={save.error ?? messages.save}
				onClick={() => {
					setOperationError(null);
					void editor.save.flush().catch(() => undefined);
				}}
			>
				{saveLabel}
			</Button>
			<Button size="sm" variant="ghost" onClick={() => setSettingsOpen(true)}>
				{messages.settings}
			</Button>
			<Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
				<DialogContent className="max-w-lg">
					<DialogTitle>{messages.settings}</DialogTitle>
					<div className="h-[min(65vh,520px)] min-h-0">
						<SettingsView />
					</div>
				</DialogContent>
			</Dialog>
			{error && (
				<span
					role="alert"
					data-testid="project-operation-error"
					className="text-xs text-destructive max-w-40 truncate"
					title={error}
				>
					{error}
				</span>
			)}
		</div>
	);
}
