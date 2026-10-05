"use client";

import { useState } from "react";
import { Download, Keyboard, MoreHorizontal } from "lucide-react";
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

/** Editor commands remain reachable when an embedding host removes its header. */
export function EditorMenu() {
	const [dialog, setDialog] = useState<"export" | "shortcuts" | null>(null);
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
						disabled={!hasProject}
						icon={<Download />}
						onSelect={() => setDialog("export")}
					>
						Export project
					</DropdownMenuItem>
					<DropdownMenuItem
						icon={<Keyboard />}
						onSelect={() => setDialog("shortcuts")}
					>
						Keyboard shortcuts
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<EditorExportDialog
				open={dialog === "export"}
				onOpenChange={(open) => {
					if (!open) setDialog(null);
				}}
			/>
			<ShortcutsDialog
				isOpen={dialog === "shortcuts"}
				onOpenChange={(open) => {
					if (!open) setDialog(null);
				}}
			/>
		</>
	);
}

function EditorExportDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
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
				aria-describedby={undefined}
				className="flex max-h-[calc(100%-2rem)] max-w-sm flex-col overflow-y-auto overscroll-contain p-0"
			>
				<DialogTitle className="sr-only">Export project</DialogTitle>
				<ExportOptions onOpenChange={changeOpen} />
			</DialogContent>
		</Dialog>
	);
}
