import { useEffect, useState, useRef } from "react";
import { useEditorSession } from "@/editor/session/editor-session-provider";
import type { TimerHandle } from "@/editor/session/resources";

interface UseScrollPositionReturn {
	scrollLeft: number;
	viewportWidth: number;
}

export function useScrollPosition({
	scrollRef,
}: {
	scrollRef: React.RefObject<HTMLElement | null>;
}): UseScrollPositionReturn {
	const [scrollLeft, setScrollLeft] = useState(0);
	const [viewportWidth, setViewportWidth] = useState(0);
	const { resources } = useEditorSession();
	const rafRef = useRef<TimerHandle | null>(null);

	useEffect(() => {
		const scrollElement = scrollRef.current;
		if (!scrollElement) return;

		const updatePosition = () => {
			if (rafRef.current !== null) {
				rafRef.current.cancel();
			}

			rafRef.current = resources.requestAnimationFrame({
				handler: () => {
					setScrollLeft(scrollElement.scrollLeft);
					setViewportWidth(scrollElement.clientWidth);
					rafRef.current = null;
				},
			});
		};

		const resizeObserver = new ResizeObserver(() => {
			updatePosition();
		});

		updatePosition();

		scrollElement.addEventListener("scroll", updatePosition, { passive: true });
		resizeObserver.observe(scrollElement);

		return () => {
			scrollElement.removeEventListener("scroll", updatePosition);
			resizeObserver.disconnect();
			if (rafRef.current !== null) {
				rafRef.current.cancel();
			}
		};
	}, [resources, scrollRef]);

	return { scrollLeft, viewportWidth };
}
