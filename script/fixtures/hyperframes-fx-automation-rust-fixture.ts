import type {
	FxAutomationInspection,
	FxAutomationRender,
	FxAutomationRequest,
} from "./hyperframes-fx-automation-fixture";
import { fxLane, fxNode, fxRequest } from "./hyperframes-fx-automation-cases";

/** Minimal valid graph: test source descriptor only, no decoding or file IO. Both
 * track and bus carry the same payload so their separate seams are compared. */
export function fxAutomationRustRequest(
	request: FxAutomationRequest,
	{ start = 0, duration = 0.16, volumeLane = false } = {},
) {
	const fades = { fadeIn: 0, fadeOut: 0 };
	const attributes = {
		fxChain: JSON.stringify(request.chain),
		automation:
			request.automation === undefined
				? null
				: JSON.stringify(request.automation),
	};
	return {
		version: 1,
		faderObservations: [],
		graph: {
			version: 1,
			semanticsProfile: "rocut-hyperframes-0.8.139-audio-graph-v1",
			frameRate: { numerator: 25, denominator: 1 },
			sampleRate: request.sampleRate,
			firstFrame: 0,
			frameCount: 4,
			durationFrames: 4,
			sources: [
				{ id: "a".repeat(64), mimeType: "audio/wav", byteLength: 4096 },
			],
			snapshot: {
				version: 1,
				nativeVersion: "0.8.139",
				time: 0,
				tracks: [
					{
						instanceId: "track#oracle",
						authorId: null,
						resourceId: "a".repeat(64),
						type: "audio",
						authoredMuted: false,
						ancestorHidden: false,
						observedAt: 0,
						native: {
							start,
							end: start + duration,
							duration,
							mediaStart: 0,
							sourceDuration: 0.16,
							playbackRate: 1,
							rate: 1,
							loop: false,
							volume: 1,
							fades,
							volumeKeyframes: volumeLane
								? []
								: [
										{ time: 0, volume: 1 },
										{ time: duration, volume: 1 },
									],
						},
						resolvedAuthorGain: {
							state: "observed",
							observedAt: 0,
							gainBeforeFades: 1,
							source: volumeLane ? "normalized-volume-lane" : "normalized-GSAP",
							points: [
								{ t: 0, v: 1 },
								{ t: duration, v: 1 },
							],
							fades,
							fallback: null,
						},
						attributes: {
							...attributes,
							groupRenderId: "bus#oracle",
							groupAuthorId: null,
							muted: false,
							hasAudio: null,
						},
					},
				],
				buses: [
					{
						instanceId: "bus#oracle",
						authorId: null,
						hidden: false,
						attributes: { ...attributes, volume: "1" },
					},
				],
			},
		},
	};
}

/** These counts come from actual native calls forwarded to actual AudioParams,
 * not an independent reimplementation of the Rust budget algorithm. */
export function observedFxAutomationCounts(result: FxAutomationRender) {
	return {
		points: result.automation.lanes.reduce(
			(count, lane) => count + lane.points.length,
			0,
		),
		curveValues: result.events.reduce(
			(count, event) =>
				count + (event.kind === "curve" ? event.values!.length : 0),
			0,
		),
		scheduledEvents: result.events.filter((event) =>
			["set", "ramp", "curve"].includes(event.kind),
		).length,
		fxAutomation: result.automation.lanes.some((lane) =>
			lane.target.startsWith("fx."),
		)
			? {
					version: 1,
					lanes: result.automation.lanes.filter((lane) =>
						lane.target.startsWith("fx."),
					),
				}
			: null,
	};
}

export function mappedKnobRustCases(
	inspection: FxAutomationInspection,
): FxAutomationRequest[] {
	return inspection.targets.map(({ target, range }) => {
		if (!range) throw Error("Native inspection target has no native range");
		const node = inspection.chain.nodes.find(
			(node) => node.id === target.split(".")[1],
		)!;
		return {
			name: `mapped-${node.type}-${target.split(".")[2]}`,
			...fxRequest(
				[node],
				[
					fxLane(target, [
						{ t: 0, v: range.min },
						{ t: 0.100017, v: range.max },
					]),
				],
			),
		};
	});
}

export function extraFxAutomationRustCases(): FxAutomationRequest[] {
	const result: FxAutomationRequest[] = [];
	const add = (
		name: string,
		nodes: Record<string, unknown>[],
		automation: unknown,
	) =>
		result.push({
			name,
			sampleRate: 48000,
			chain: { version: 1, nodes },
			automation,
		});
	const lane = (points: unknown[]) => ({
		version: 1,
		lanes: [{ target: "fx.n1.gain", points }],
	});
	for (const [name, nodes] of [
		[
			"duplicate-id-first-gain-last-biquad",
			[fxNode("gain"), fxNode("peaking")],
		],
		[
			"duplicate-id-first-biquad-last-gain",
			[fxNode("peaking"), fxNode("gain")],
		],
		[
			"duplicate-id-disabled-first-range-still-used",
			[fxNode("gain", {}, "n1", { enabled: false }), fxNode("peaking")],
		],
		[
			"duplicate-id-disabled-last-not-scheduled",
			[fxNode("peaking"), fxNode("gain", {}, "n1", { enabled: false })],
		],
		["duplicate-id-last-has-no-target", [fxNode("gain"), fxNode("delay")]],
	] as const)
		add(
			name,
			[...nodes],
			lane([
				{ t: 0, v: -100 },
				{ t: 0.1, v: 100 },
			]),
		);
	add("empty-duplicate-lane-before-real-lane", [fxNode("gain")], {
		version: 1,
		lanes: [
			fxLane("fx.n1.gain", []),
			fxLane("fx.n1.gain", [
				{ t: 0, v: -6 },
				{ t: 0.1, v: 6 },
			]),
		],
	});
	add(
		"numeric-string-null-duplicates-and-shapes",
		[fxNode("gain")],
		lane([
			{ t: "0.1", v: "900" },
			{ t: -1, v: -100, curve: 9 },
			{ t: "0x0", v: -6, curve: "-.5" },
			{ t: 0.1, v: 2, viaX: 0.5, viaY: 0.1 },
			{ t: null, v: 1 },
			{ t: 0.08, v: "" },
		]),
	);
	add(
		"clamped-equal-knobs-are-constant",
		[fxNode("gain")],
		lane([
			{ t: 0, v: 100, curve: 1 },
			{ t: 0.1, v: 900 },
		]),
	);
	add(
		"mapped-late-seed-minimum-curve",
		[fxNode("gain")],
		lane([
			{ t: 0.02, v: -6 },
			{ t: 0.020001, v: 0 },
		]),
	);
	add(
		"mapped-curve-cap-after-crop",
		[fxNode("gain")],
		lane([
			{ t: 0, v: -6 },
			{ t: 50, v: 6 },
		]),
	);
	add("equal-via-is-native-straight", [fxNode("delay")], {
		version: 1,
		lanes: [
			fxLane("fx.n1.feedback", [
				{ t: 0, v: 0.1, viaX: 0.5, viaY: 0.5 },
				{ t: 0.1, v: 0.3 },
			]),
		],
	});
	add(
		"split-preset-disabled-gap-merges-runs",
		[
			fxNode("gain", { gain: 6 }, "n1", { fromPreset: "voice" }),
			fxNode("gain", {}, "gap", { enabled: false }),
			fxNode("gain", { gain: 6 }, "n2", { fromPreset: "voice" }),
		],
		{
			version: 1,
			lanes: [
				fxLane("fx.preset.voice", [
					{ t: 0, v: 0 },
					{ t: 0.1, v: 1 },
				]),
			],
		},
	);
	add("volume-and-fx-projections", [fxNode("gain")], {
		version: 1,
		lanes: [
			fxLane("volume", [
				{ t: 0, v: 1 },
				{ t: 0.16, v: 1 },
			]),
			fxLane("volume", [{ t: 0, v: 2 }]),
			fxLane("fx.n1.gain", [
				{ t: 0, v: -6 },
				{ t: 0.1, v: 6 },
			]),
		],
	});
	return result;
}
