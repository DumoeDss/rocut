import { useRef } from "react";
import { Button } from "../../components/ui/button";

const PANELS = [
	{ id: "assets", label: "Media & text" },
	{ id: "preview", label: "Preview" },
	{ id: "properties", label: "Inspector" },
] as const;
export type FocusPanel = (typeof PANELS)[number]["id"];

/** Mounted panels keep their drafts and renderer state when a narrow host changes views. */
export function EditorFocusTabs({
	value,
	onChange,
}: {
	readonly value: FocusPanel;
	readonly onChange: (value: FocusPanel) => void;
}) {
	const ref = useRef<HTMLDivElement>(null);
	return (
		<div
			ref={ref}
			role="tablist"
			aria-label="Editor views"
			className="flex shrink-0 gap-1 px-3 pb-1"
		>
			{PANELS.map((panel, index) => (
				<Button
					key={panel.id}
					type="button"
					role="tab"
					id={"focus-tab-" + panel.id}
					aria-controls={"editor-" + panel.id}
					aria-selected={value === panel.id}
					tabIndex={value === panel.id ? 0 : -1}
					variant={value === panel.id ? "secondary" : "ghost"}
					size="sm"
					className="min-w-0 flex-1"
					onClick={() => onChange(panel.id)}
					onKeyDown={(event) => {
						let next: number;
						if (event.key === "ArrowRight") next = (index + 1) % PANELS.length;
						else if (event.key === "ArrowLeft")
							next = (index + PANELS.length - 1) % PANELS.length;
						else if (event.key === "Home") next = 0;
						else if (event.key === "End") next = PANELS.length - 1;
						else return;
						event.preventDefault();
						onChange(PANELS[next].id);
						ref.current
							?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
							[next]?.focus();
					}}
				>
					{panel.label}
				</Button>
			))}
		</div>
	);
}
