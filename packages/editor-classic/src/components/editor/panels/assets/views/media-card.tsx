import type { ReactNode } from "react";
import { SelectableItem } from "../../../../../selection";

/** Preview belongs to the card itself; nested controls own their native keys. */
export function MediaCard({
	id,
	name,
	isUsed = false,
	children,
	onPreview,
}: {
	id: string;
	name: string;
	isUsed?: boolean;
	children: ReactNode;
	onPreview: () => void;
}) {
	return (
		<SelectableItem
			className="min-w-0 w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			id={id}
			aria-label={name}
			aria-description={`${isUsed ? "已使用" : "未使用"}；Enter 预览；空格选择；Ctrl 或 Command 加空格切换选择；Shift 加空格连续选择`}
			data-used={isUsed}
			data-testid="native-media-card"
			onDoubleClick={onPreview}
			onKeyDown={(event) => {
				if (
					event.defaultPrevented ||
					event.target !== event.currentTarget ||
					event.key !== "Enter" ||
					event.ctrlKey ||
					event.metaKey ||
					event.shiftKey ||
					event.altKey
				)
					return;
				event.preventDefault();
				event.stopPropagation();
				onPreview();
			}}
		>
			{children}
			{isUsed && (
				<span className="pointer-events-none inline-block rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
					已使用
				</span>
			)}
		</SelectableItem>
	);
}
