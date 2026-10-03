import { cn } from "../../../../../utils/ui";

interface PanelViewProps extends React.HTMLAttributes<HTMLDivElement> {
	title?: string;
	actions?: React.ReactNode;
	children: React.ReactNode;
	footer?: React.ReactNode;
	contentClassName?: string;
	scrollClassName?: string;
	hideHeader?: boolean;
	ref?: React.Ref<HTMLDivElement>;
	onScroll?: React.UIEventHandler<HTMLDivElement>;
	scrollRef?: React.Ref<HTMLDivElement>;
}

export function PanelView({
	title,
	actions,
	children,
	footer,
	className,
	contentClassName,
	scrollClassName,
	hideHeader = false,
	ref,
	onScroll,
	scrollRef,
	...rest
}: PanelViewProps) {
	return (
		<div
			className={cn("relative flex h-full min-h-0 min-w-0 flex-col", className)}
			ref={ref}
			{...rest}
		>
			{!hideHeader && (
				<div className="bg-background min-h-11 shrink-0 px-2 py-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b">
					{title && (
						<span className="text-muted-foreground text-sm">{title}</span>
					)}
					{actions}
				</div>
			)}
			<div
				className={cn(
					"scrollbar-thin min-h-0 w-full flex-1 overflow-y-auto overscroll-contain",
					hideHeader ? "pt-4" : "pt-2",
					scrollClassName,
				)}
				ref={scrollRef}
				onScroll={onScroll}
			>
				<div className={cn("w-full flex-1 px-2 pt-0", contentClassName)}>
					{children}
				</div>
			</div>
			{footer && (
				<div className="bg-background shrink-0 border-t p-2">{footer}</div>
			)}
		</div>
	);
}
