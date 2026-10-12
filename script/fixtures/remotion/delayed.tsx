import React from "react";
import { useDelayRender } from "remotion";

declare global {
	interface Window {
		__rocutRemotionReadinessObserve?: (event: {
			kind: string;
			extra?: Record<string, unknown>;
		}) => void;
		__rocutRemotionReadinessNode?: HTMLDivElement | null;
	}
}

export default function Delayed({ mode }: { mode?: string }) {
	const { delayRender, continueRender, cancelRender } = useDelayRender();
	const [handle] = React.useState(() => {
		const value = delayRender("diagnostic asynchronous state");
		window.__rocutRemotionReadinessObserve?.({
			kind: "fixture-handle-acquired",
			extra: { handle: value },
		});
		return value;
	});
	const [ready, setReady] = React.useState(false);
	const diagnosticNode = React.useRef<HTMLDivElement>(null);
	React.useLayoutEffect(() => {
		window.__rocutRemotionReadinessNode = diagnosticNode.current;
		window.__rocutRemotionReadinessObserve?.({
			kind: "fixture-layout-commit",
			extra: { ready, handle },
		});
	}, [ready, handle]);
	React.useEffect(() => {
		if (mode === "stall") return;
		window.__rocutRemotionReadinessObserve?.({
			kind: "fixture-effect-timer-scheduled",
			extra: { handle },
		});
		const timer = setTimeout(() => {
			window.__rocutRemotionReadinessObserve?.({
				kind: "fixture-timer-fired",
				extra: { handle },
			});
			if (mode === "cancel") {
				cancelRender(Error("intentional-remotion-cancel"));
				return;
			}
			setReady(true);
			window.__rocutRemotionReadinessObserve?.({
				kind: "fixture-state-update-enqueued",
				extra: { handle },
			});
			continueRender(handle);
			window.__rocutRemotionReadinessObserve?.({
				kind: "fixture-native-handle-released",
				extra: { handle },
			});
		}, 40);
		return () => {
			clearTimeout(timer);
			window.__rocutRemotionReadinessObserve?.({
				kind: "fixture-effect-cleanup",
				extra: { handle },
			});
		};
	}, [handle, mode, continueRender, cancelRender]);
	return (
		<div
			ref={diagnosticNode}
			style={{
				position: "absolute",
				left: 48,
				top: 0,
				width: 16,
				height: 16,
				background: ready ? "#00ffff" : "#ff0000",
			}}
		/>
	);
}
