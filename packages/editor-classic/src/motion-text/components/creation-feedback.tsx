"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { Alert02Icon } from "@hugeicons/core-free-icons";
import { cn } from "../../utils/ui";

export interface MotionTextCreationMessage {
	readonly kind: "error" | "warning";
	readonly text: string;
	readonly field?: "source" | "duration";
}

export function MotionTextCreationFeedback({
	message,
}: {
	readonly message: MotionTextCreationMessage | null;
}) {
	if (!message) return null;
	return (
		<div
			id="motion-text-message"
			role={message.kind === "error" ? "alert" : "status"}
			className={cn(
				"flex items-start gap-2 rounded-md border p-2 text-xs leading-5",
				message.kind === "error"
					? "border-destructive/40 text-destructive"
					: "border-caution/40 text-caution",
			)}
		>
			<HugeiconsIcon icon={Alert02Icon} size={14} className="mt-0.5 shrink-0" />
			<span>{message.text}</span>
		</div>
	);
}
