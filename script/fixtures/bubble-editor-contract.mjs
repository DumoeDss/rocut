export const bubbleEditorContract = Object.freeze({
	width: 192,
	height: 128,
	frameRate: { numerator: 30, denominator: 1 },
	duration: 480000,
	start: 12000,
	keyTime: 120000,
	clipId: "bubble-ui-clip",
	disabledId: "bubble-ui-disabled",
	standaloneId: "bubble-ui-standalone",
	graphicTrack: "bubble-ui-graphics",
	effectTrack: "bubble-ui-effects",
	opticalKey: "refraction",
	opticalLabel: "Optical plane distance (short-side fraction)",
	keyframeTitle: "Toggle optical plane distance (short-side fraction) keyframe",
	pointTimeLabel: "point1Time",
	activityLabel: "Activity duration (ticks)",
	mode: "real-dom-bubble-authoring-history-persistence; no pixel/export oracle",
});

export function bubbleEditorClips(creator, resource, catalog) {
	const params = Object.fromEntries(
		catalog.effects.bubble
			.filter((param) => param.required !== false)
			.map((param) => [param.key, param.default]),
	);
	const shot = creator.bubbleImage({
		image: resource,
		settings: {
			width: 192,
			height: 128,
			frameRate: bubbleEditorContract.frameRate,
			durationFrames: 120,
			seed: 97,
		},
		params: Object.fromEntries(
			Object.entries(params).filter(
				([key]) => key !== "pointCount" && !/^point\d/.test(key),
			),
		),
		knots: [{ time: 0, x: 0.5, y: 0.5 }],
		keyframes: {},
	});
	const editing = {
		type: "graphic",
		name: "Bubble UI clip",
		definitionId: "programmatic",
		params: {},
		programmatic: shot.source,
		effects: shot.effects,
		animations: shot.animations,
	};
	return [
		{
			id: bubbleEditorContract.clipId,
			trackId: bubbleEditorContract.graphicTrack,
			startTime: 12000,
			duration: 480000,
			trimStart: 0,
			trimEnd: 0,
			editing,
		},
		{
			id: bubbleEditorContract.disabledId,
			trackId: bubbleEditorContract.graphicTrack,
			startTime: 504000,
			duration: 480000,
			trimStart: 0,
			trimEnd: 0,
			editing: {
				...structuredClone(editing),
				name: "Disabled Bubble UI clip",
				effects: shot.effects.map((effect) => ({
					...structuredClone(effect),
					enabled: false,
				})),
			},
		},
		{
			id: bubbleEditorContract.standaloneId,
			trackId: bubbleEditorContract.effectTrack,
			startTime: 996000,
			duration: 480000,
			trimStart: 0,
			trimEnd: 0,
			editing: {
				type: "effect",
				name: "Standalone Bubble UI",
				effectType: "bubble",
				params: structuredClone(shot.effects[0].params),
				animations: {},
			},
		},
	];
}
