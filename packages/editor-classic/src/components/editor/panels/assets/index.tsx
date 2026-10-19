"use client";

import { Separator } from "../../../ui/separator";
import {
	type Tab,
	useAssetsPanelStore,
} from "../../../../editor/use-session-store";
import { TabBar } from "./tabbar";
import { Captions } from "../../../../subtitles/components/assets-view";
import { MediaView } from "./views/assets";
import { SettingsView } from "./views/settings";
import { SoundsView } from "../../../../sounds/components/assets-view";
import { StickersView } from "../../../../stickers/components/assets-view";
import { TextView } from "../../../../text/components/assets-view";
import { EffectsView } from "../../../../effects/components/assets-view";
import { AdjustmentAssetsView } from "../../../../effects/components/adjustment-assets-view";
import { MotionTextAssetsView } from "../../../../motion-text/components/assets-view";
import { TransitionsView } from "../../../../transitions/transitions-view";
import { CreatorPlansView, CreatorProjectLibraryView } from "../../../../editor/surface/creator-panel-views";
import { useCreatorWorkspaceBridge } from "../../../../editor/surface/creator-workspace-context";

export function AssetsPanel() {
	const { activeTab } = useAssetsPanelStore();
	const creatorBridge = useCreatorWorkspaceBridge();

	const viewMap: Record<
		Exclude<Tab, "plans" | "project-assets">,
		React.ReactNode
	> = {
		media: <MediaView />,
		sounds: <SoundsView />,
		text: <TextView />,
		"motion-text": <MotionTextAssetsView />,
		stickers: <StickersView />,
		effects: <EffectsView />,
		transitions: <TransitionsView />,
		captions: <Captions />,
		adjustment: <AdjustmentAssetsView />,
		settings: <SettingsView />,
	};
	const creatorTab = activeTab === "plans" || activeTab === "project-assets";
	const visibleTab = creatorTab && !creatorBridge ? "media" : activeTab;

	return (
		<div className="panel bg-background flex h-full rounded-sm border overflow-hidden">
			<TabBar />
			<Separator orientation="vertical" />
			<div className="min-w-0 flex-1 overflow-hidden">
				{creatorBridge && (
					<>
						<div className="h-full" hidden={activeTab !== "plans"}>
							<CreatorPlansView />
						</div>
						<div className="h-full" hidden={activeTab !== "project-assets"}>
							<CreatorProjectLibraryView />
						</div>
					</>
				)}
				{visibleTab !== "plans" && visibleTab !== "project-assets" && (
					<div className="h-full">
						{viewMap[visibleTab]}
					</div>
				)}
			</div>
		</div>
	);
}
