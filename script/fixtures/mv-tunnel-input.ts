import type { TunnelOracleFrame } from "./mv-tunnel-oracle";
export function snapshotTunnelInput(
	value: TunnelOracleFrame,
): TunnelOracleFrame {
	const f = structuredClone(value);
	if (
		![f.time, f.shotStart, f.duration, f.bpm].every(Number.isFinite) ||
		f.shotStart < 0 ||
		f.duration <= 0 ||
		f.duration > 60 ||
		f.time < f.shotStart ||
		f.time > f.shotStart + f.duration ||
		f.bpm < 1 ||
		f.bpm > 1000 ||
		!Number.isInteger(f.downbeatIndex0) ||
		f.downbeatIndex0 < 0 ||
		f.downbeatIndex0 >= f.beats.length ||
		!Array.isArray(f.beats) ||
		!f.beats.length ||
		f.beats.length > 21600 ||
		f.beats.some(
			(b, i) =>
				!Number.isFinite(b) ||
				b < 0 ||
				b > 21600 ||
				(i > 0 && b <= f.beats[i - 1]!),
		)
	)
		throw Error("Invalid explicit tunnel shot/whole-song clock");
	const keys = new Set([
		"words",
		"plan",
		"f",
		"v0",
		"v1",
		"fadeIn",
		"toward",
		"reveal",
	]);
	const text = (s: unknown): s is string =>
		typeof s === "string" &&
		s.length > 0 &&
		s.length <= 256 &&
		[...s].every(
			(ch) => ch.codePointAt(0)! >= 32 && ch.codePointAt(0)! !== 127,
		);
	if (Object.keys(f.args).some((k) => !keys.has(k)))
		throw Error("Unknown original tunnel argument");
	const { words, plan } = f.args;
	if (
		words !== undefined &&
		(!Array.isArray(words) ||
			!words.length ||
			words.length > 32 ||
			!words.every(text))
	)
		throw Error("Invalid tunnel words");
	if (
		plan !== undefined &&
		(!Array.isArray(plan) ||
			!plan.length ||
			plan.length > 256 ||
			plan.some(
				(p: unknown) =>
					!Array.isArray(p) ||
					p.length !== 2 ||
					typeof p[0] !== "number" ||
					!Number.isFinite(p[0]) ||
					p[0] < 0 ||
					p[0] > 21600 ||
					!text(p[1]),
			))
	)
		throw Error("Invalid original absolute plan");
	for (const [key, min, max] of [
		["f", 1, 4096],
		["v0", 0.01, 100],
		["v1", 0.01, 100],
		["fadeIn", 0, 60],
	] as const) {
		const v = f.args[key];
		if (
			v !== undefined &&
			(typeof v !== "number" || !Number.isFinite(v) || v < min || v > max)
		)
			throw Error(`Invalid tunnel ${key}`);
	}
	for (const key of ["toward", "reveal"])
		if (f.args[key] !== undefined && !text(f.args[key]))
			throw Error(`Invalid tunnel ${key}`);
	return f;
}
