"use client";

import { forwardRef } from "react";
import * as ResizablePrimitive from "react-resizable-panels";

import { cn } from "../../utils/ui";

const ResizablePanelGroup = forwardRef<
	ResizablePrimitive.ImperativePanelGroupHandle,
	React.ComponentProps<typeof ResizablePrimitive.PanelGroup>
>(({ className, ...props }, ref) => (
	<ResizablePrimitive.PanelGroup
		ref={ref}
		className={cn(
			"flex size-full data-[panel-group-direction=vertical]:flex-col",
			className,
		)}
		{...props}
	/>
));
ResizablePanelGroup.displayName = "ResizablePanelGroup";

const ResizablePanel = ResizablePrimitive.Panel;

const ResizableHandle = ({
	withHandle,
	className,
	...props
}: React.ComponentProps<typeof ResizablePrimitive.PanelResizeHandle> & {
	withHandle?: boolean;
}) => (
	<ResizablePrimitive.PanelResizeHandle
		className={cn(
			"focus-visible:ring-ring relative flex w-px items-center justify-center bg-transparent data-[resize-handle-state=hover]:bg-border/50 data-[resize-handle-state=drag]:bg-primary/50 after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:ring-1 focus-visible:ring-offset-1 focus-visible:outline-hidden data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full data-[panel-group-direction=vertical]:after:left-0 data-[panel-group-direction=vertical]:after:h-1 data-[panel-group-direction=vertical]:after:w-full data-[panel-group-direction=vertical]:after:translate-x-0 data-[panel-group-direction=vertical]:after:-translate-y-1/2 [&[data-panel-group-direction=vertical]>span]:rotate-90",
			className,
		)}
		{...props}
	>
		{withHandle && (
			<span
				aria-hidden="true"
				className="bg-border pointer-events-none h-7 w-0.5 rounded-full"
			/>
		)}
	</ResizablePrimitive.PanelResizeHandle>
);

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
