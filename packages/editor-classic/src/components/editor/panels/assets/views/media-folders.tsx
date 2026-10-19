import { useState } from "react";
import { useEditor, useEditorInstance } from "../../../../../editor/use-editor";
import { useSelection } from "../../../../../selection";
import { generateUUID } from "../../../../../utils/id";
import { Button } from "../../../../ui/button";
import { useEditorMessages } from "../../../../../editor/host/editor-host-context";

export const ALL_MEDIA = "@all";
export const ROOT_MEDIA = "@root";

export function MediaFolders({
	active,
	onSelect,
}: {
	active: string;
	onSelect: (id: string) => void;
}) {
	const messages = useEditorMessages();
	const editor = useEditorInstance();
	const folders = useEditor((current) => current.media.getFolders());
	const available = useEditor((current) =>
		current.media.isFolderEditingAvailable(),
	);
	const [name, setName] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState(false);
	const selected = folders.find((folder) => folder.id === active);
	const run = async (kind: "create" | "rename" | "dissolve") => {
		if (!available || busy || (kind !== "create" && !selected)) return;
		if (kind !== "dissolve" && !name.trim()) return;
		setBusy(true);
		setError(false);
		try {
			if (kind === "create") {
				const id = generateUUID();
				await editor.media.mutateFolders({
					kind,
					id,
					name: name.trim(),
					parentId: selected?.id,
				});
				onSelect(id);
			} else if (kind === "rename") {
				await editor.media.mutateFolders({
					kind,
					id: selected!.id,
					name: name.trim(),
				});
			} else {
				await editor.media.mutateFolders({ kind, id: selected!.id });
				onSelect(selected?.parentId ?? ROOT_MEDIA);
			}
			setName("");
		} catch {
			setError(true);
		} finally {
			setBusy(false);
		}
	};
	return (
		<div className="space-y-2 border-b py-2 text-xs" aria-label={messages.mediaFolders}>
			<label className="flex items-center gap-2">
				{messages.folder}
				<select
					aria-label={messages.browseFolders}
					value={
						selected ? active : active === ROOT_MEDIA ? ROOT_MEDIA : ALL_MEDIA
					}
					onChange={(event) => onSelect(event.target.value)}
					className="min-w-0 flex-1 rounded border bg-background p-1"
				>
					<option value={ALL_MEDIA}>{messages.allMedia}</option>
					<option value={ROOT_MEDIA}>{messages.ungroupedMedia}</option>
					{folders.map((folder) => (
						<option key={folder.id} value={folder.id}>
							{folderLabel({ folder, folders })}
						</option>
					))}
				</select>
			</label>
			{!available && (
				<p role="status" className="text-muted-foreground">
					{messages.foldersUnavailable}
				</p>
			)}
			<input
				aria-label={messages.folderName}
				placeholder={messages.folderName}
				value={name}
				disabled={!available || busy}
				onChange={(event) => setName(event.target.value)}
				className="w-full rounded border bg-background px-2 py-1"
			/>
			<div className="flex flex-wrap gap-1">
				<Button
					size="sm"
					variant="outline"
					disabled={!available || busy || !name.trim()}
					onClick={() => void run("create")}
				>
					{selected ? messages.createSubfolder : messages.createFolder}
				</Button>
				<Button
					size="sm"
					variant="ghost"
					disabled={!available || busy || !selected || !name.trim()}
					onClick={() => void run("rename")}
				>
					{messages.rename}
				</Button>
				<Button
					size="sm"
					variant="ghost"
					disabled={!available || busy || !selected}
					onClick={() => void run("dissolve")}
				>
					{messages.dissolveFolder}
				</Button>
			</div>
			<p className="text-muted-foreground">
				{messages.dissolveFolderHelp}
			</p>
			{error && <p role="alert">{messages.folderFailed}</p>}
		</div>
	);
}

export function folderLabel({
	folder,
	folders,
}: {
	folder: { id: string; name: string; parentId?: string };
	folders: readonly { id: string; name: string; parentId?: string }[];
}) {
	const path = [folder.name],
		seen = new Set([folder.id]);
	let parent = folder.parentId;
	while (parent && !seen.has(parent)) {
		seen.add(parent);
		const entry = folders.find((item) => item.id === parent);
		if (!entry) break;
		path.unshift(entry.name);
		parent = entry.parentId;
	}
	return path.join(" / ");
}

export function MoveMediaSelection() {
	const messages = useEditorMessages();
	const editor = useEditorInstance();
	const { selectedIds } = useSelection();
	const folders = useEditor((current) => current.media.getFolders());
	const available = useEditor((current) =>
		current.media.isFolderEditingAvailable(),
	);
	const [target, setTarget] = useState(ROOT_MEDIA);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState(false);
	if (!selectedIds.length) return null;
	return (
		<div
			className="flex flex-wrap items-center gap-2 py-2 text-xs"
			aria-label={messages.moveMedia}
		>
			<select
				aria-label={messages.targetFolder}
				disabled={!available || busy}
				value={target}
				onChange={(event) => setTarget(event.target.value)}
				className="min-w-0 max-w-full rounded border bg-background p-1"
			>
				<option value={ROOT_MEDIA}>{messages.ungroupedMedia}</option>
				{folders.map((folder) => (
					<option key={folder.id} value={folder.id}>
						{folderLabel({ folder, folders })}
					</option>
				))}
			</select>
			<Button
				size="sm"
				variant="outline"
				disabled={
					!available ||
					busy ||
					(target !== ROOT_MEDIA &&
						!folders.some((folder) => folder.id === target))
				}
				onClick={async () => {
					setBusy(true);
					setError(false);
					try {
						await editor.media.mutateFolders({
							kind: "move-assets",
							assetIds: [...selectedIds],
							folderId: target === ROOT_MEDIA ? undefined : target,
						});
					} catch {
						setError(true);
					} finally {
						setBusy(false);
					}
				}}
			>
				{messages.move} ({selectedIds.length})
			</Button>
			{error && <p role="alert">{messages.moveFailed}</p>}
		</div>
	);
}
