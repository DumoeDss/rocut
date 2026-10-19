"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../ui/tooltip";
import { Button } from "../../../ui/button";
import { EditorMenu } from "../../editor-menu";
import { cn } from "../../../../utils/ui";
import {
	TAB_KEYS,
	tabs,
	useAssetsPanelStore,
} from "../../../../editor/use-session-store";
import { useCreatorWorkspaceBridge } from "../../../../editor/surface/creator-workspace-context";
const toolLabels: Record<string, string> = { plans: "\u8ba1\u5212", "project-assets": "\u9879\u76ee\u7d20\u6750\u5e93", media: "\u7d20\u6750", sounds: "\u97f3\u6548", text: "\u6587\u672c", "motion-text": "\u52a8\u6001\u6587\u5b57", motionText: "\u52a8\u6001\u6587\u5b57", stickers: "\u8d34\u7eb8", effects: "\u7279\u6548", transitions: "\u8f6c\u573a", captions: "\u5b57\u5e55", adjustment: "\u8c03\u6574", settings: "\u9879\u76ee\u8bbe\u7f6e" };

export function TabBar() {
	const { activeTab, setActiveTab } = useAssetsPanelStore();
	const creatorBridge = useCreatorWorkspaceBridge();
	const visibleTabs = creatorBridge
		? TAB_KEYS
		: TAB_KEYS.filter(
				(tabKey) => tabKey !== "plans" && tabKey !== "project-assets",
			);
	const [showTopFade, setShowTopFade] = useState(false);
	const [showBottomFade, setShowBottomFade] = useState(false);
	const scrollRef = useRef<HTMLDivElement>(null);

	const checkScrollPosition = useCallback(() => {
		const element = scrollRef.current;
		if (!element) return;

		const { scrollTop, scrollHeight, clientHeight } = element;
		setShowTopFade(scrollTop > 0);
		setShowBottomFade(scrollTop < scrollHeight - clientHeight - 1);
	}, []);

	useEffect(() => {
		const element = scrollRef.current;
		if (!element) return;

		checkScrollPosition();
		element.addEventListener("scroll", checkScrollPosition);

		const resizeObserver = new ResizeObserver(checkScrollPosition);
		resizeObserver.observe(element);

		return () => {
			element.removeEventListener("scroll", checkScrollPosition);
			resizeObserver.disconnect();
		};
	}, [checkScrollPosition]);

	return (
		<div className="relative flex min-h-0 flex-col">
			<div className="relative min-h-0 flex-1">
				<div
					ref={scrollRef}
					className="scrollbar-hidden relative flex size-full p-1 flex-col items-center justify-start gap-0.5 overflow-y-auto"
				>
					{visibleTabs.map((tabKey) => {
						const tab = tabs[tabKey];
						const label = toolLabels[tabKey] ?? tab.label;
						return (
							<Tooltip key={tabKey} delayDuration={10}>
								<TooltipTrigger asChild>
									<Button
										variant={activeTab === tabKey ? "secondary" : "ghost"}
										size="icon"
										aria-label={label}
										data-testid={`assets-tab-${tabKey}`}
										className={cn(
											"shrink-0",
											"h-8 w-8",
											activeTab !== tabKey && "text-muted-foreground",
										)}
										onClick={() => setActiveTab(tabKey)}
									>
										<tab.icon />
									</Button>
								</TooltipTrigger>
								<TooltipContent
									side="right"
									align="center"
									variant="sidebar"
									sideOffset={8}
								>
									<div className="text-foreground text-sm leading-none font-medium">
										{label}
									</div>
								</TooltipContent>
							</Tooltip>
						);
					})}
				</div>

				<FadeOverlay direction="top" show={showTopFade} />
				<FadeOverlay direction="bottom" show={showBottomFade} />
			</div>
			<div className="shrink-0 border-t border-border p-1">
				<EditorMenu />
			</div>
		</div>
	);
}

function FadeOverlay({
	direction,
	show,
}: {
	direction: "top" | "bottom";
	show: boolean;
}) {
	return (
		<div
			className={cn(
				"pointer-events-none absolute right-0 left-0 h-6",
				direction === "top" && show
					? "from-background top-0 bg-linear-to-b to-transparent"
					: "from-background bottom-0 bg-linear-to-t to-transparent",
			)}
		/>
	);
}

