import { useCallback, useEffect, useState } from "react";
import { useEditorInstance } from "@/editor/use-editor";
import type { TProjectMetadata } from "@/project/types";

/**
 * A deliberately plain project list / create / open surface.
 *
 * This is host code, not editor code — the Next app has its own `/projects`
 * page and this stands in for it. It exists so "create or open a project" is
 * reachable without hand-crafting a project id, which means the identity seam
 * gets exercised honestly rather than bypassed.
 *
 * Persistence is acquired from the session-owned editor coordinator, whose
 * store is the stable browser implementation configured by the Vite Host.
 * Creating and opening still go through `EditorCore`, because those load a
 * project *into the editor* rather than merely reading storage.
 */
export function ProjectPicker({
	onOpen,
}: {
	onOpen: (projectId: string) => void;
}) {
	const editor = useEditorInstance();
	const [projects, setProjects] = useState<TProjectMetadata[]>([]);
	const [storageUsage, setStorageUsage] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		try {
			setIsLoading(true);
			const summaries = await editor.persistence.listProjects();
			setProjects(
				summaries.map((project) => ({
					...project,
					createdAt: new Date(project.createdAt),
					updatedAt: new Date(project.updatedAt),
				})),
			);
			const info = await editor.persistence.store.inspect();
			// Capacity is null when the browser declines to estimate. Say so rather
			// than rendering a confident 0 MB.
			setStorageUsage(
				info.availability !== "available" || info.capacity === null
					? "unknown (browser gave no estimate)"
					: `${(info.capacity.usedBytes / 1048576).toFixed(1)} MB`,
			);
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load projects");
		} finally {
			setIsLoading(false);
		}
	}, [editor.persistence]);

	useEffect(() => {
		refresh();
	}, [refresh]);

	const handleCreate = async () => {
		try {
			const projectId = await editor.project.createNewProject({
				name: "Untitled Project",
			});
			onOpen(projectId);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to create project");
		}
	};

	return (
		<div className="flex size-full flex-col gap-4 overflow-auto p-6">
			<div className="flex items-center justify-between">
				<h1 className="text-foreground text-xl font-semibold">Projects</h1>
				<button
					type="button"
					onClick={handleCreate}
					className="bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm"
				>
					New project
				</button>
			</div>

			{storageUsage !== null ? (
				<p className="text-muted-foreground text-xs" data-testid="storage-used">
					Browser storage in use: {storageUsage}
				</p>
			) : null}

			{error ? <p className="text-destructive text-sm">{error}</p> : null}
			{isLoading ? (
				<p className="text-muted-foreground text-sm">Loading projects…</p>
			) : null}

			{!isLoading && projects.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					No projects yet. Create one to open the editor.
				</p>
			) : null}

			<ul className="flex flex-col gap-2">
				{projects.map((project) => (
					<li key={project.id}>
						<button
							type="button"
							onClick={() => onOpen(project.id)}
							className="hover:bg-accent hover:text-accent-foreground border-border w-full rounded-md border px-3 py-2 text-left text-sm"
							data-testid="project-row"
						>
							<span className="text-foreground">{project.name}</span>
							<span className="text-muted-foreground ml-2 text-xs">
								{project.id}
							</span>
						</button>
					</li>
				))}
			</ul>
		</div>
	);
}
