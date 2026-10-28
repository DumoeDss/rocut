import { useRef, useState, type ReactNode } from "react";
import { Plus, SlidersHorizontal } from "lucide-react";
import { Button } from "../../../../ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "../../../../ui/dropdown-menu";
import { useEditorMessages } from "../../../../../editor/host/editor-host-context";

export function MediaLibraryToolbar({
	counts,
	type,
	onTypeChange,
	query,
	onQueryChange,
	used,
	onUsedChange,
	onImport,
	onGenerate,
	importing,
	generating,
	children,
}: {
	counts: Record<string, number>;
	type: string;
	onTypeChange: (value: string) => void;
	query: string;
	onQueryChange: (value: string) => void;
	used: boolean;
	onUsedChange: (value: boolean) => void;
	onImport: () => void;
	onGenerate?: (type: "image" | "video") => void;
	importing: boolean;
	generating?: boolean;
	children?: ReactNode;
}) {
	const messages = useEditorMessages();
	const [expanded, setExpanded] = useState(false);
	const openingGenerator = useRef(false);
	const filtered = Boolean(query || used);
	const types = [
		["all", messages.allTypes],
		["image", messages.image],
		["video", messages.video],
		["audio", messages.audio],
		...(counts.programmatic ? [["programmatic", messages.programmatic]] : []),
	];
	return (
		<div className="media-library-toolbar">
			<div className="media-library-heading">
				<h2>{messages.library}</h2>
				<div
					className="media-library-types"
					role="group"
					aria-label={messages.assetType}
				>
					{types.map(([value, label]) => (
						<button
							type="button"
							key={value}
							aria-pressed={type === value}
							data-testid={`library-filter-${value}`}
							onClick={() => onTypeChange(value)}
						>
							{label}
							<span>{counts[value] ?? 0}</span>
						</button>
					))}
				</div>
				<div className="media-library-actions">
					<Button
						size="icon"
						variant={filtered ? "secondary" : "ghost"}
						aria-label={messages.searchAssets}
						aria-expanded={expanded}
						data-testid="library-search-toggle"
						onClick={() => setExpanded(!expanded)}
					>
						<SlidersHorizontal />
					</Button>
					<DropdownMenu modal={false}>
						<DropdownMenuTrigger asChild>
							<Button
								size="icon"
								variant="ghost"
								aria-label={messages.addAsset}
								data-testid="library-add"
							>
								<Plus />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent
							align="end"
							className="min-w-44"
							onCloseAutoFocus={(event) => {
								// In narrow layouts the generator replaces this panel. Keep the
								// content navigation's focus instead of focusing a hidden trigger.
								if (openingGenerator.current) event.preventDefault();
								openingGenerator.current = false;
							}}
						>
							<DropdownMenuItem
								disabled={importing}
								onSelect={onImport}
								data-testid="library-import"
							>
								{messages.importAssets}
							</DropdownMenuItem>
							{onGenerate && (
								<>
									<DropdownMenuItem
										disabled={generating}
										onSelect={() => {
											openingGenerator.current = true;
											onGenerate("image");
										}}
										data-testid="creator-generate-image"
									>
										{messages.generateImage}
									</DropdownMenuItem>
									<DropdownMenuItem
										disabled={generating}
										onSelect={() => {
											openingGenerator.current = true;
											onGenerate("video");
										}}
										data-testid="creator-generate-video"
									>
										{messages.generateVideo}
									</DropdownMenuItem>
								</>
							)}
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</div>
			{expanded && (
				<div className="media-library-filters">
					<input
						type="search"
						className="creator-search"
						aria-label={messages.searchAssets}
						placeholder={messages.search}
						value={query}
						onChange={(event) => onQueryChange(event.target.value)}
					/>
					<div className="flex flex-wrap items-center gap-2 text-xs">
						<label className="flex items-center gap-1">
							<input
								type="checkbox"
								checked={used}
								onChange={(event) => onUsedChange(event.target.checked)}
							/>
							{messages.used}
						</label>
						<Button
							size="sm"
							variant="ghost"
							data-testid="creator-clear-filters"
							disabled={!filtered && type === "all"}
							onClick={() => {
								onQueryChange("");
								onTypeChange("all");
								onUsedChange(false);
							}}
						>
							{messages.clearFilters}
						</Button>
						{children}
					</div>
				</div>
			)}
		</div>
	);
}
