"use client";

import { useRef, useState } from "react";
import {
	ClipboardCheck,
	Download,
	Keyboard,
	MoreHorizontal,
} from "lucide-react";
import { useEditorHost } from "../../editor/host/editor-host-context";
import { DraftReviewDialog } from "./draft-review-dialog";
import { ShortcutsDialog } from "../../actions/components/shortcuts-dialog";
import { useEditor, useEditorInstance } from "../../editor/use-editor";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { ExportOptions } from "./export-button";
import { ClipExportDialog } from "./clip-export-dialog";

/** Editor commands remain reachable when an embedding host removes its header. */
export function EditorMenu() {
	const [dialog, setDialog] = useState<
		"export" | "clips" | "shortcuts" | "drafts" | null
	>(null);
	const { draftReview } = useEditorHost();
	const triggerRef = useRef<HTMLButtonElement>(null);
	const restoreFocus = (event: Event) => {
		event.preventDefault();
		triggerRef.current?.focus();
	};
	const hasProject = useEditor(
		(editor) => editor.project.getActiveOrNull() !== null,
	);
	return (
		<>
			<DropdownMenu>
				<Tooltip>
					<TooltipTrigger asChild>
						<DropdownMenuTrigger asChild>
							<Button
								ref={triggerRef}
								variant="ghost"
								size="icon"
								className="size-8 text-muted-foreground"
								aria-label="Editor menu"
								data-testid="editor-menu-trigger"
							>
								<MoreHorizontal aria-hidden="true" />
							</Button>
						</DropdownMenuTrigger>
					</TooltipTrigger>
					<TooltipContent side="right">Editor menu</TooltipContent>
				</Tooltip>
				<DropdownMenuContent
					side="right"
					align="end"
					className="w-48"
					onCloseAutoFocus={(event) => {
						if (dialog) event.preventDefault();
					}}
				>
					<DropdownMenuItem
						disabled={!hasProject || !draftReview}
						icon={<ClipboardCheck />}
						onSelect={() => setDialog("drafts")}
					>
						Review agent changes
					</DropdownMenuItem>
					<DropdownMenuItem
						disabled={!hasProject}
						icon={<Download />}
						onSelect={() => setDialog("export")}
					>
						Export project
					</DropdownMenuItem>
					<DropdownMenuItem
						disabled={!hasProject}
						icon={<Download />}
						onSelect={() => setDialog("clips")}
					>
						Export clips
					</DropdownMenuItem>
					<DropdownMenuItem
						icon={<Keyboard />}
						onSelect={() => setDialog("shortcuts")}
					>
						Keyboard shortcuts
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			{draftReview && (
				<DraftReviewDialog
					port={draftReview}
					open={dialog === "drafts"}
					onOpenChange={(open) => {
						if (!open) setDialog(null);
					}}
					onCloseAutoFocus={restoreFocus}
				/>
			)}
			{dialog === "clips" && (
				<ClipExportMenuDialog
					onClose={() => setDialog(null)}
					onCloseAutoFocus={restoreFocus}
				/>
			)}
			<EditorExportDialog
				onCloseAutoFocus={restoreFocus}
				open={dialog === "export"}
				onOpenChange={(open) => {
					if (!open) setDialog(null);
				}}
			/>
			<ShortcutsDialog
				onCloseAutoFocus={restoreFocus}
				isOpen={dialog === "shortcuts"}
				onOpenChange={(open) => {
					if (!open) setDialog(null);
				}}
			/>
		</>
	);
}

function ClipExportMenuDialog({
	onClose,
	onCloseAutoFocus,
}: {
	onClose: () => void;
	onCloseAutoFocus: (event: Event) => void;
}) {
	const editor = useEditorInstance();
	const selected = editor.selection.getSelectedElements();
	return (
		<ClipExportDialog
			selection={
				selected.length
					? { kind: "elements", references: selected }
					: { kind: "all" }
			}
			onClose={onClose}
			onCloseAutoFocus={onCloseAutoFocus}
		/>
	);
}

function EditorExportDialog({
	open,
	onOpenChange,
	onCloseAutoFocus,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onCloseAutoFocus: (event: Event) => void;
}) {
	const editor = useEditorInstance();
	const isExporting = useEditor(
		(instance) => instance.project.getExportState().isExporting,
	);
	const changeOpen = (next: boolean) => {
		if (!next) {
			if (isExporting) editor.project.cancelExport();
			else editor.project.clearExportState();
		}
		onOpenChange(next);
	};
	return (
		<Dialog open={open} onOpenChange={changeOpen}>
			<DialogContent
				onCloseAutoFocus={onCloseAutoFocus}
				aria-describedby={undefined}
				className="flex max-h-[calc(100%-2rem)] max-w-sm flex-col overflow-y-auto overscroll-contain p-0"
			>
				<DialogTitle className="sr-only">Export project</DialogTitle>
				<ExportOptions onOpenChange={changeOpen} />
			</DialogContent>
		</Dialog>
	);
}
