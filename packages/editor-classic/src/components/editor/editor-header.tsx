"use client";

import { Button } from "../ui/button";
import { useRef, useState } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { RenameProjectDialog } from "../../project/components/rename-project-dialog";
import { DeleteProjectDialog } from "../../project/components/delete-project-dialog";
import {
	useEditorHostBranding,
	useEditorHostLinks,
	useEditorHostNavigation,
	useEditorHostServices,
	useEditorMessages,
} from "../../editor/host/editor-host-context";
import { FaDiscord } from "react-icons/fa6";
import { ExportButton } from "./export-button";
import { FeedbackPopover } from "../../feedback/components/feedback-popover";
import { ThemeToggle } from "../theme-toggle";
import { toast } from "sonner";
import { useEditor, useEditorInstance } from "../../editor/use-editor";
import { CommandIcon, Logout05Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { ShortcutsDialog } from "../../actions/components/shortcuts-dialog";
import { HostImage } from "../../editor/host/host-image";
import { cn } from "../../utils/ui";
import { ProjectOperations } from "./project-operations";

export function EditorHeader({ hostOwnsChrome = false }: { hostOwnsChrome?: boolean }) {
	const { feedbackEndpoint } = useEditorHostServices();

	return (
		<header
			data-editor-header=""
			className="bg-background flex min-h-11 shrink-0 flex-wrap items-center justify-between gap-1 px-3 py-1"
		>
			<div className="flex min-w-0 flex-1 basis-24 items-center gap-1 overflow-hidden">
				{!hostOwnsChrome && <ProjectDropdown />}
				<EditableProjectName />
			</div>
			<ProjectOperations />
			<nav className="flex shrink-0 items-center gap-2">
				{/* Feedback posts to a server route; a host without one hides it
				    entirely rather than offering a control that cannot work. */}
				{feedbackEndpoint && !hostOwnsChrome ? <FeedbackPopover /> : null}
				<ExportButton />
				{!hostOwnsChrome && <ThemeToggle />}
			</nav>
		</header>
	);
}

function ProjectDropdown() {
	const [openDialog, setOpenDialog] = useState<
		"delete" | "rename" | "shortcuts" | null
	>(null);
	const [isExiting, setIsExiting] = useState(false);
	const navigation = useEditorHostNavigation();
	const { logoUrl } = useEditorHostBranding();
	const { discordUrl } = useEditorHostLinks();
	const editor = useEditorInstance();
	const activeProject = useEditor((e) => e.project.getActive());

	const handleExit = async () => {
		if (isExiting) return;
		setIsExiting(true);

		try {
			await editor.project.prepareExit();
			await editor.project.closeProject();
		} catch (error) {
			console.error("Failed to prepare project exit:", error);
		} finally {
			await editor.project.closeProject();
			navigation.onExitProject();
		}
	};

	const handleSaveProjectName = async (newName: string) => {
		if (
			activeProject &&
			newName.trim() &&
			newName !== activeProject.metadata.name
		) {
			try {
				await editor.project.renameProject({
					id: activeProject.metadata.id,
					name: newName.trim(),
				});
			} catch (error) {
				toast.error("工程重命名失败", {
					description:
						error instanceof Error ? error.message : "请重试",
				});
			} finally {
				setOpenDialog(null);
			}
		}
	};

	const handleDeleteProject = async () => {
		if (activeProject) {
			try {
				await editor.project.deleteProjects({
					ids: [activeProject.metadata.id],
				});
				navigation.onExitProject();
			} catch (error) {
				toast.error("删除工程失败", {
					description:
						error instanceof Error ? error.message : "请重试",
				});
			} finally {
				setOpenDialog(null);
			}
		}
	};

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="ghost" size="icon" className="p-1 rounded-sm size-8">
						<HostImage
							src={logoUrl}
							alt="工程缩略图"
							width={32}
							height={32}
							className="invert dark:invert-0 size-5"
						/>
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" className="z-100 w-44">
					<DropdownMenuItem
						onClick={handleExit}
						disabled={isExiting}
						icon={<HugeiconsIcon icon={Logout05Icon} />}
					>
						退出工程
					</DropdownMenuItem>

					<DropdownMenuItem
						onClick={() => setOpenDialog("shortcuts")}
						icon={<HugeiconsIcon icon={CommandIcon} />}
					>
						快捷键
					</DropdownMenuItem>

					<DropdownMenuSeparator />

					<DropdownMenuItem asChild icon={<FaDiscord className="size-4!" />}>
						<a href={discordUrl} target="_blank" rel="noopener noreferrer">
							Discord
						</a>
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<RenameProjectDialog
				isOpen={openDialog === "rename"}
				onOpenChange={(isOpen) => setOpenDialog(isOpen ? "rename" : null)}
				onConfirm={(newName) => handleSaveProjectName(newName)}
				projectName={activeProject?.metadata.name || ""}
			/>
			<DeleteProjectDialog
				isOpen={openDialog === "delete"}
				onOpenChange={(isOpen) => setOpenDialog(isOpen ? "delete" : null)}
				onConfirm={handleDeleteProject}
				projectNames={[activeProject?.metadata.name || ""]}
			/>
			<ShortcutsDialog
				isOpen={openDialog === "shortcuts"}
				onOpenChange={(isOpen) => setOpenDialog(isOpen ? "shortcuts" : null)}
			/>
		</>
	);
}

function EditableProjectName() {
	const messages = useEditorMessages();
	const editor = useEditorInstance();
	const activeProject = useEditor((e) => e.project.getActive());
	const [isEditing, setIsEditing] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const originalNameRef = useRef("");

	const projectName = activeProject?.metadata.name || "";

	const startEditing = () => {
		if (isEditing) return;
		originalNameRef.current = projectName;
		setIsEditing(true);

		editor.resources.requestAnimationFrame({
			handler: () => {
				inputRef.current?.select();
			},
		});
	};

	const saveEdit = async () => {
		if (!inputRef.current || !activeProject) return;
		const newName = inputRef.current.value.trim();
		setIsEditing(false);

		if (!newName) {
			inputRef.current.value = originalNameRef.current;
			return;
		}

		if (newName !== originalNameRef.current) {
			try {
				await editor.project.renameProject({
					id: activeProject.metadata.id,
					name: newName,
				});
			} catch (error) {
				toast.error("工程重命名失败", {
					description:
						error instanceof Error ? error.message : "请重试",
				});
			}
		}
	};

	const handleKeyDown = (event: React.KeyboardEvent) => {
		if (event.key === "Enter") {
			event.preventDefault();
			inputRef.current?.blur();
		} else if (event.key === "Escape") {
			event.preventDefault();
			if (inputRef.current) {
				inputRef.current.value = originalNameRef.current;
				inputRef.current.setSelectionRange(0, 0);
			}
			setIsEditing(false);
			inputRef.current?.blur();
		}
	};

	return (
		<input
			ref={inputRef}
			type="text"
			aria-label={messages.projectName}
			defaultValue={projectName}
			readOnly={!isEditing}
			onClick={startEditing}
			onBlur={saveEdit}
			onKeyDown={handleKeyDown}
			className={cn(
				"[field-sizing:content] min-w-0 max-w-full truncate text-[0.9rem] h-8 px-2 py-1 rounded-sm bg-transparent outline-none cursor-pointer hover:bg-accent hover:text-accent-foreground",
				isEditing && "ring-1 ring-ring cursor-text hover:bg-transparent",
			)}
		/>
	);
}
