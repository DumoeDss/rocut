import assert from "node:assert/strict";

export const controlTriangle = {
	position: [
		[0, 0, 0],
		[1, 0, 0],
		[0, 1, 0],
	],
	primitiveIndex: 17,
	materialIndex: 29,
};
export const controlBase = {
	triangles: [controlTriangle],
	count: 2,
	seed: 1977,
};
export const controlMotion = {
	version: 1,
	timeTicks: 0,
	scatterStartTicks: 0,
	scatterDurationTicks: 120000,
	holdDurationTicks: 120000,
	returnDurationTicks: 120000,
	scatterDistance: 0,
	driftAmplitude: 0,
	driftFrequency: 0.5,
	size: 2,
	sizeVariance: 0,
};
export const springControl = {
	mode: "spring",
	startTicks: 0,
	durationTicks: 120000,
	knots: [
		{ timeTicks: 0, position: [2, 0, 0] },
		{ timeTicks: 120000, position: [2, 0, 0] },
	],
	restoringForce: 4,
	damping: 2,
	radius: 10,
	strength: 12,
};
export type ParticleJsonResolver = (json: string) => string;
const motionRequest = (timeTicks: number, control?: unknown) => ({
	...controlBase,
	motion: {
		...controlMotion,
		timeTicks,
		...(control === undefined ? {} : { control }),
	},
});

// Expectations below are independent one-step physics, not captured new-core output.
export function verifyParticleControl(
	resolver: ParticleJsonResolver,
	legacyResolver: ParticleJsonResolver,
) {
	const call = (input: unknown) => {
		const raw = resolver(JSON.stringify(input)),
			value = JSON.parse(raw);
		assert.equal(value.ok, true, raw);
		return { raw, value };
	};
	assert.equal(
		resolver(JSON.stringify(controlBase)),
		legacyResolver(JSON.stringify(controlBase)),
	);
	for (const time of [0, 1000, 24000, 120000, 240000])
		assert.equal(
			call(motionRequest(time)).raw,
			legacyResolver(JSON.stringify(motionRequest(time))),
		);
	const baseline = call(motionRequest(1000)).value.samples;
	for (const time of [0, 1000, 24000, 120000, 240000])
		assert.equal(
			call(motionRequest(time, { ...springControl, strength: 0 })).raw,
			call(motionRequest(time)).raw,
			"zero force must keep exact legacy bytes",
		);
	const spring = call(motionRequest(1000, springControl)).value.samples;
	const springSecond = call(motionRequest(2000, springControl)).value.samples;
	const close = (actual: number, expected: number) =>
		assert(
			Math.abs(actual - expected) < 1e-12,
			`${actual} vs independent ${expected}`,
		);
	for (let i = 0; i < baseline.length; i++) {
		const base = baseline[i].position,
			vector = [2 - base[0], -base[1], -base[2]],
			distance = Math.hypot(...vector),
			falloff = 1 - distance / 10;
		for (let axis = 0; axis < 3; axis++)
			close(
				spring[i].motionPosition[axis],
				base[axis] + (12 * vector[axis] * falloff) / (120 * 120),
			);
		assert(spring[i].motionPosition[0] > base[0]);
		assert(spring[i].motionPosition[1] < base[1]);
		// Two steps exercise both restoring force and damping, which are zero at step one.
		const offset1 = vector.map((value) => (12 * value * falloff) / (120 * 120));
		const velocity1 = offset1.map((value) => value * 120);
		const vector2 = vector.map((value, axis) => value - offset1[axis]);
		const falloff2 = 1 - Math.hypot(...vector2) / 10;
		for (let axis = 0; axis < 3; axis++) {
			const acceleration2 =
				12 * vector2[axis] * falloff2 - 4 * offset1[axis] - 2 * velocity1[axis];
			close(
				springSecond[i].motionPosition[axis],
				base[axis] +
					offset1[axis] +
					(velocity1[axis] + acceleration2 / 120) / 120,
			);
		}
	}
	assert.notEqual(
		call(motionRequest(2000, { ...springControl, restoringForce: 0 })).raw,
		call(motionRequest(2000, springControl)).raw,
		"restoring force must change second-step physics",
	);
	const vortexControl = {
			...springControl,
			mode: "vortex",
			axis: [0, 0, 1],
			knots: [
				{ timeTicks: 0, position: [0, 0, 0] },
				{ timeTicks: 120000, position: [0, 0, 0] },
			],
		},
		vortex = call(motionRequest(1000, vortexControl)).value.samples;
	for (let i = 0; i < baseline.length; i++) {
		const base = baseline[i].position,
			falloff = 1 - Math.hypot(...base) / 10;
		close(
			vortex[i].motionPosition[0],
			base[0] + (12 * base[1] * falloff) / (120 * 120),
		);
		close(
			vortex[i].motionPosition[1],
			base[1] - (12 * base[0] * falloff) / (120 * 120),
		);
		close(vortex[i].motionPosition[2], base[2]);
	}
	const seek = call(motionRequest(24000, springControl)).raw;
	call(motionRequest(96000, springControl));
	call(motionRequest(1000, springControl));
	assert.equal(
		call(motionRequest(24000, springControl)).raw,
		seek,
		"seek order must not affect replay",
	);
	for (const time of [0, 120000, 240000])
		assert.equal(
			call(motionRequest(time, springControl)).raw,
			call(motionRequest(time)).raw,
			"start/end/outside must return exactly to legacy",
		);
	const unsupported = JSON.parse(
		legacyResolver(JSON.stringify(motionRequest(1000, springControl))),
	);
	assert.equal(unsupported.ok, false);
	assert.equal(unsupported.samples, undefined);
	for (const control of [
		{
			...springControl,
			knots: [
				{ timeTicks: 0, position: [2, 0, 0] },
				{ timeTicks: 0, position: [2, 0, 0] },
			],
		},
		{ ...springControl, durationTicks: 12000001 },
		{ ...vortexControl, axis: [0, 0, 0] },
		{ ...springControl, radius: 0 },
	]) {
		const invalid = JSON.parse(
			resolver(JSON.stringify(motionRequest(1000, control))),
		);
		assert.equal(invalid.ok, false);
		assert.equal(invalid.samples, undefined);
	}
	const tooMuchWork = JSON.parse(
		resolver(
			JSON.stringify({ ...motionRequest(1000, springControl), count: 65536 }),
		),
	);
	assert.equal(tooMuchWork.ok, false);
	assert.equal(tooMuchWork.samples, undefined);
	return {
		ok: true,
		legacyBytesEqual: true,
		zeroForceBytesEqual: true,
		springOneStepIndependent: true,
		springRestoringDampingTwoStepIndependent: true,
		vortexDirectionIndependent: true,
		seekOrderIndependent: true,
		endpointBytesEqual: true,
		oldWasmRejects: true,
		invalidControlAndWorkBudgetReject: true,
		spring,
		vortex,
	};
}

export function verifyOldParticleControlRejects(
	resolver: ParticleJsonResolver,
) {
	const legacy = JSON.parse(resolver(JSON.stringify(controlBase)));
	assert.equal(legacy.ok, true);
	const motion = JSON.parse(resolver(JSON.stringify(motionRequest(1000))));
	assert.equal(motion.ok, true);
	const negative = JSON.parse(
		resolver(JSON.stringify(motionRequest(1000, springControl))),
	);
	assert.equal(negative.ok, false);
	assert.equal(negative.samples, undefined);
	return {
		legacyAccepted: true,
		motionAccepted: true,
		controlRejected: true,
		negative,
	};
}
