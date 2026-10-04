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

export function AssetsPanel() {
	const { activeTab } = useAssetsPanelStore();

	const viewMap: Record<Tab, React.ReactNode> = {
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

	return (
		<div className="panel bg-background flex h-full rounded-sm border overflow-hidden">
			<TabBar />
			<Separator orientation="vertical" />
			<div className="min-w-0 flex-1 overflow-hidden">{viewMap[activeTab]}</div>
		</div>
	);
}
