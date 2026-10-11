import { REMOTION_NATIVE_VIDEO_OBSERVATION_SOURCE } from "./remotion-native-video-observation";

/** Passive, bounded browser observations. No scheduler or gate changes. */
export const REMOTION_READINESS_OBSERVATION_SOURCE =
	String.raw`const readinessDiagnostic = {
	profile: "passive-remotion-readiness-v1",
	frameIndex: null,
	events: [],
	dropped: 0,
};
window.__rocutRemotionReadinessTrace = readinessDiagnostic;
` +
	REMOTION_NATIVE_VIDEO_OBSERVATION_SOURCE +
	String.raw`
const observeReadiness = ({ kind, extra = {} }) => {
	try {
		if (kind === 'settle-done' || kind === 'html-ready-before-message') {
			const observer = Object.getOwnPropertyDescriptor(window, '__rocutRemotionNativeVideoObserve');
			if (observer && 'value' in observer && typeof observer.value === 'function') observer.value(kind);
		}
		if (readinessDiagnostic.events.length >= 128) {
			readinessDiagnostic.dropped++;
			return;
		}
		const node = window.__rocutRemotionReadinessNode;
		readinessDiagnostic.events.push({
			sequence: readinessDiagnostic.events.length,
			kind,
			now: performance.now(),
			frameIndex: readinessDiagnostic.frameIndex,
			renderReady: window.remotion_renderReady,
			handleCount: Array.isArray(window.remotion_delayRenderHandles)
				? window.remotion_delayRenderHandles.length
				: null,
			handles: Array.isArray(window.remotion_delayRenderHandles)
				? window.remotion_delayRenderHandles.slice(0, 8)
				: null,
			domConnected: node ? node.isConnected : null,
			inlineColor: node ? node.style.backgroundColor : null,
			...extra,
		});
	} catch {
		/* Observation must not affect frame readiness. */
	}
};
window.__rocutRemotionReadinessObserve = observeReadiness;
`;

/** Emit retained observations only after the PNG and its original checks. */
export function printRemotionReadinessObservation({
	evaluation,
}: {
	evaluation: unknown;
}) {
	if (
		typeof evaluation !== "object" ||
		evaluation === null ||
		!("value" in evaluation)
	)
		return;
	const value = evaluation.value;
	if (
		typeof value !== "object" ||
		value === null ||
		!("readinessDiagnostic" in value) ||
		!value.readinessDiagnostic
	)
		return;
	try {
		console.error(
			"ROCUT_REMOTION_READINESS " + JSON.stringify(value.readinessDiagnostic),
		);
	} catch {
		/* Logging must not replace the original result or error. */
	}
}
