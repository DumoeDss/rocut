"use client";

import * as React from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { useSurfacePortalContainer } from "@/editor/surface/embedding/surface-portal";
import { cn } from "@/utils/ui";
import { useOverlayOpenChange } from "./use-overlay-open-change";

function Popover({
	open,
	onOpenChange,
	...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
	const handleOpenChange = useOverlayOpenChange({
		open,
		onOpenChange,
	});
	return (
		<PopoverPrimitive.Root
			open={open}
			onOpenChange={handleOpenChange}
			{...props}
		/>
	);
}

const PopoverTrigger = PopoverPrimitive.Trigger;

const PopoverAnchor = PopoverPrimitive.Anchor;

const PopoverClose = PopoverPrimitive.Close;

function PopoverPortal(
	props: React.ComponentProps<typeof PopoverPrimitive.Portal>,
) {
	const container = useSurfacePortalContainer(props.container);
	return <PopoverPrimitive.Portal {...props} container={container} />;
}

const PopoverContent = React.forwardRef<
	React.ElementRef<typeof PopoverPrimitive.Content>,
	React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 4, ...props }, ref) => (
	<PopoverPortal>
		<PopoverPrimitive.Content
			ref={ref}
			align={align}
			sideOffset={sideOffset}
			className={cn(
				"bg-popover text-popover-foreground z-50 w-72 rounded-md border p-4 shadow-[0_0_10px_rgba(0,0,0,0.15)] outline-hidden",
				className,
			)}
			{...props}
		/>
	</PopoverPortal>
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor, PopoverClose };
