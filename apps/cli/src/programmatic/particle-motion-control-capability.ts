import * as wasm from "opencut-wasm";

/** Probe current core only, not the native worker, renderer or transport health. */
export function getProgrammaticParticleMotionControlCapability(
	exports: Readonly<Record<string, unknown>> = wasm as unknown as Readonly<
		Record<string, unknown>
	>,
) {
	const sampler = exports.sampleParticleSurfaceJson;
	let available = typeof sampler === "function";
	for (const mode of ["spring", "vortex"] as const) {
		if (!available) break;
		try {
			const raw: unknown = (sampler as (input: string) => unknown)(
				JSON.stringify({
					triangles: [
						{
							position: [
								[1, 0, 0],
								[2, 0, 0],
								[1, 1, 0],
							],
							primitiveIndex: 0,
						},
					],
					count: 1,
					seed: 0,
					motion: {
						version: 1,
						timeTicks: 1000,
						scatterStartTicks: 0,
						scatterDurationTicks: 1000,
						holdDurationTicks: 0,
						returnDurationTicks: 1000,
						scatterDistance: 0,
						driftAmplitude: 0,
						driftFrequency: 1,
						size: 1,
						sizeVariance: 0,
						control: {
							mode,
							startTicks: 0,
							durationTicks: 2000,
							knots: [
								{ timeTicks: 0, position: [0, 0, 0] },
								{ timeTicks: 2000, position: [0, 0, 0] },
							],
							restoringForce: 1,
							damping: 0,
							radius: 2,
							strength: 1,
							...(mode === "vortex" ? { axis: [0, 0, 1] } : {}),
						},
					},
				}),
			);
			if (typeof raw !== "string" || raw.length > 65536) {
				available = false;
				break;
			}
			const result = JSON.parse(raw),
				sample = result.samples?.[0];
			const vector = (value: unknown): value is number[] =>
				Array.isArray(value) &&
				value.length === 3 &&
				value.every(
					(entry) => typeof entry === "number" && Number.isFinite(entry),
				);
			available =
				result.version === 1 &&
				result.ok === true &&
				result.samples.length === 1 &&
				vector(sample?.position) &&
				vector(sample?.motionPosition) &&
				sample.primitiveIndex === 0 &&
				typeof sample.size === "number" &&
				Number.isFinite(sample.size) &&
				sample.size > 0 &&
				sample.motionPosition.some(
					(entry: number, index: number) => entry !== sample.position[index],
				);
		} catch {
			available = false;
		}
	}
	return {
		version: 1,
		profile: "explicit-control-v1",
		available,
		modes: ["spring", "vortex"],
	};
}
