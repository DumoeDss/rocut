import { difference, modes, original, plan } from "./mv-surface-fixture";
import { originalPixels, pixelPlan } from "./mv-surface-pixels-fixture";
import {
	raster,
	type SurfaceBackend,
	type SurfaceBatch,
} from "./mv-surface-raster";
import type { SurfaceMutation } from "./mv-surface-mutations";

const equal = (actual: unknown, expected: unknown) =>
	JSON.stringify(actual) === JSON.stringify(expected);
export function surfaceLifecycleProof(
	lifecycle: SurfaceBatch["lifecycle"][number],
) {
	return {
		unusedReleasedBeforeNextAllocation: equal(lifecycle.snapshots[2], [[1, 1]]),
		pixelsReleasedAfterConsumption: equal(lifecycle.snapshots[8], [
			[1, 1],
			[1, 1],
			[96, 96],
		]),
		scaledReleasedAfterBlur: equal(lifecycle.snapshots[11], [
			[1, 1],
			[1, 1],
			[1, 1],
			[96, 96],
		]),
		lastSurfaceReleasedAfterOutput: equal(lifecycle.snapshots[14], [
			[1, 1],
			[1, 1],
			[1, 1],
			[1, 1],
		]),
		allReleased: equal(lifecycle.final, [
			[1, 1],
			[1, 1],
			[1, 1],
			[1, 1],
		]),
	};
}

async function pixelChecks({
	backend,
	bytes,
}: {
	backend: SurfaceBackend;
	bytes: ArrayBuffer;
}) {
	const expected = originalPixels();
	const { frames, lifecycle } = await raster({
		backend,
		bytes,
		plans: [pixelPlan(), pixelPlan(true), plan("difference"), pixelPlan()],
	});
	const positive = difference(expected, frames[0]!);
	const retainOracle = difference(expected, frames[1]!);
	const releaseUnchanged = difference(frames[0]!, frames[1]!);
	const repeated = difference(frames[0]!, frames[3]!);
	const repeatOracle = difference(expected, frames[3]!);
	const intervening = difference(frames[0]!, frames[2]!);
	const releaseProof = surfaceLifecycleProof(lifecycle[0]!);
	const repeatReleaseProof = surfaceLifecycleProof(lifecycle[3]!);
	const retainedUntilFinally =
		equal(lifecycle[1]!.snapshots.at(-1), [
			[32, 32],
			[8, 6],
			[96, 96],
			[96, 96],
		]) &&
		equal(lifecycle[1]!.final, [
			[1, 1],
			[1, 1],
			[1, 1],
			[1, 1],
		]);
	const negatives: {
		mutation: SurfaceMutation;
		difference: ReturnType<typeof difference>;
	}[] = [];
	for (const mutation of [
		"omitBlur",
		"wrongSmoothing",
		"transparentGray",
		"prematureRelease",
	] as const) {
		const result = await raster({
			backend,
			bytes,
			plans: [pixelPlan()],
			mutation,
		});
		negatives.push({
			mutation,
			difference: difference(expected, result.frames[0]!),
		});
	}
	return {
		passed:
			[positive, retainOracle, releaseUnchanged, repeated, repeatOracle].every(
				(metric) => metric.max === 0,
			) &&
			intervening.max > 20 &&
			Object.values(releaseProof).every(Boolean) &&
			Object.values(repeatReleaseProof).every(Boolean) &&
			retainedUntilFinally &&
			negatives.every(
				({ difference: metric }) =>
					metric.max > 20 && metric.mae > 1 && metric.changedChannels > 500,
			),
		positive,
		retainOracle,
		releaseUnchanged,
		repeated,
		repeatOracle,
		intervening,
		releaseProof,
		repeatReleaseProof,
		retainedUntilFinally,
		negatives,
		lifecycle,
	};
}

export async function surfaceBackendChecks({
	backend,
	bytes,
}: {
	backend: SurfaceBackend;
	bytes: ArrayBuffer;
}) {
	const checks = [];
	for (const mode of modes) {
		const expected = original(mode);
		const {
			frames: [actual, noPaper, noGradient, flattened],
		} = await raster({
			backend,
			bytes,
			plans: [
				plan(mode),
				plan(mode, { omitPaper: true }),
				plan(mode, { omitGradient: true }),
				plan(mode, { flatten: true }),
			],
		});
		checks.push({
			mode,
			positive: difference(expected, actual!),
			omitPaper: difference(expected, noPaper!),
			omitGradient: difference(expected, noGradient!),
			flatten: difference(expected, flattened!),
			flattenOracle: difference(original(mode, true), flattened!),
		});
	}
	const {
		frames: [first, other, again],
	} = await raster({
		backend,
		bytes,
		plans: [plan("source-in"), plan("difference"), plan("source-in")],
	});
	const repeated = difference(first!, again!);
	const repeatOracle = difference(original("source-in"), again!);
	const intervening = difference(first!, other!);
	const pixels = await pixelChecks({ backend, bytes });
	return {
		backend,
		passed:
			checks.every(
				(c) =>
					c.positive.max === 0 &&
					c.omitPaper.max > 20 &&
					c.omitGradient.max > 20 &&
					c.flatten.max > 5 &&
					c.flattenOracle.max === 0,
			) &&
			repeated.max === 0 &&
			repeatOracle.max === 0 &&
			intervening.max > 20 &&
			pixels.passed,
		checks,
		repeated,
		repeatOracle,
		intervening,
		pixels,
	};
}
