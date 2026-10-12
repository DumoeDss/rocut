import { captureParticleBaselineTopology } from "./particle-authority-baseline-topology.mjs";

// Independent CPU identities: do not pin or learn IDs from any compile run.
export function initialTopologyFixture() {
	const sceneState = {
		currentSceneId: "cpu-scene",
		scenes: [
			{
				id: "cpu-scene",
				name: "Main scene",
				isMain: true,
				mainTrackId: "cpu-main",
			},
		],
	};
	const main = {
		id: "cpu-main",
		name: "Main Track",
		type: "video",
		elements: [],
		muted: false,
		hidden: false,
	};
	return {
		sceneState,
		state: {
			revision: 0,
			clips: [],
			tracks: [
				{
					id: main.id,
					kind: main.type,
					name: main.name,
					muted: main.muted,
					hidden: main.hidden,
					sceneId: "cpu-scene",
				},
			],
		},
		record: {
			data: {
				currentSceneId: "cpu-scene",
				motionTextSequences: [],
				scenes: [
					{
						id: "cpu-scene",
						name: "Main scene",
						isMain: true,
						bookmarks: [],
						tracks: { overlay: [], main, audio: [] },
					},
				],
			},
		},
	};
}

export function baselineState() {
	const source = {
		width: 320,
		height: 240,
		durationFrames: 121,
		frameRate: { numerator: 30, denominator: 1 },
		build: {
			inputProps: {
				rotationSpeed: [0, 0, 0],
				motion: {
					scatterDistance: 0.75,
					size: 3.25,
					driftAmplitude: 0,
					scatterStartTicks: 0,
					scatterDurationTicks: 120000,
					holdDurationTicks: 120000,
					returnDurationTicks: 120000,
				},
			},
		},
	};
	const initial = initialTopologyFixture();
	const baselineTopology = captureParticleBaselineTopology(initial);
	const state = {
		revision: 2,
		tracks: [
			...initial.state.tracks,
			{
				id: "particle-track",
				name: "Particle C4",
				kind: "graphic",
				hidden: false,
				sceneId: "cpu-scene",
			},
		],
		clips: [
			{
				id: "particle-model",
				trackId: "particle-track",
				startTime: 0,
				duration: 484000,
				trimStart: 0,
				trimEnd: 0,
				editing: {
					name: "Private particle fixture",
					type: "graphic",
					definitionId: "programmatic",
					effects: [],
					params: { opacity: 0.85 },
					programmatic: structuredClone(source),
				},
			},
		],
	};
	const record = structuredClone(initial.record),
		clip = state.clips[0];
	record.data.metadata = { duration: 484000 };
	record.data.settings = {
		canvasSize: { width: 1920, height: 1080 },
		fps: { numerator: 30, denominator: 1 },
	};
	record.data.scenes[0].tracks.overlay = [
		{
			id: "particle-track",
			name: "Particle C4",
			type: "graphic",
			hidden: false,
			elements: [
				{
					id: clip.id,
					name: clip.editing.name,
					type: clip.editing.type,
					startTime: clip.startTime,
					duration: clip.duration,
					trimStart: clip.trimStart,
					trimEnd: clip.trimEnd,
					params: structuredClone(clip.editing.params),
					effects: [],
					definitionId: clip.editing.definitionId,
					programmatic: structuredClone(source),
				},
			],
		},
	];
	return {
		source,
		state,
		record,
		sceneState: initial.sceneState,
		baselineTopology,
	};
}
