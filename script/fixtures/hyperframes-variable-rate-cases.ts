import type { RateLane, RateSpec } from "./hyperframes-variable-rate-native";

export interface VariableRateCase {
	id: string;
	channels: number;
	sampleRate: number;
	duration: number;
	mediaStart: number;
	rate: RateSpec;
}
const lane = (points: RateLane["points"]): RateLane => ({
	target: "rate",
	points,
});

export const variableRateCases: VariableRateCase[] = [
	{
		id: "unity-stereo",
		channels: 2,
		sampleRate: 48000,
		duration: 1.13,
		mediaStart: 0.125,
		rate: 1,
	},
	{
		id: "rising-log",
		channels: 2,
		sampleRate: 48000,
		duration: 1.13,
		mediaStart: 0.125,
		rate: lane([
			{ t: 0, v: 0.5 },
			{ t: 1.13, v: 2 },
		]),
	},
	{
		id: "falling-log-mono",
		channels: 1,
		sampleRate: 48000,
		duration: 0.73,
		mediaStart: 0.075,
		rate: lane([
			{ t: 0, v: 2 },
			{ t: 0.73, v: 0.5 },
		]),
	},
	{
		id: "exponent-44100",
		channels: 2,
		sampleRate: 44100,
		duration: 0.91,
		mediaStart: 0.12,
		rate: lane([
			{ t: 0, v: 0.6, curve: 0.7 },
			{ t: 0.91, v: 2.1 },
		]),
	},
	{
		id: "via-stereo",
		channels: 2,
		sampleRate: 48000,
		duration: 1.07,
		mediaStart: 0.15,
		rate: lane([
			{ t: 0, v: 1.9, viaX: 0.32, viaY: 0.8 },
			{ t: 1.07, v: 0.7 },
		]),
	},
	{
		id: "held-multisegment",
		channels: 2,
		sampleRate: 48000,
		duration: 1.27,
		mediaStart: 0.1,
		rate: lane([
			{ t: 0.1, v: 0.7 },
			{ t: 0.38, v: 1.8, curve: -0.5 },
			{ t: 0.79, v: 0.9 },
		]),
	},
];

/** Independent source-time envelope and stereo frequencies expose wrong trims
 * and rate trajectories, unlike a stationary sine-only test. */
export function variableRateSample(sampleRate: number) {
	return (frame: number, channel: number) => {
		const t = frame / sampleRate;
		const envelope =
			0.2 +
			0.12 * Math.sin(2 * Math.PI * 1.7 * t) +
			0.04 * Math.cos(2 * Math.PI * 0.29 * t);
		return (
			envelope *
				Math.sin(2 * Math.PI * ((channel ? 347 : 211) * t + 7 * t * t)) +
			0.04 * Math.sin(2 * Math.PI * (channel ? 691 : 503) * t)
		);
	};
}
