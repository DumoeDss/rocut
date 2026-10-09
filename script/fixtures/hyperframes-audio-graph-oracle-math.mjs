import assert from "node:assert/strict";
import {
	RecordedParam,
	near,
} from "./hyperframes-audio-graph-oracle-support.mjs";

const timing = { scheduledAt: 0, elapsed: 0, rate: 1 };
const lane = (points) => ({ target: "volume", points });

export function mathCases(native, check) {
	check("audio-param-linear-and-mid-segment", "native-scheduling", () => {
		const input = lane([
			{ t: 0, v: 0 },
			{ t: 1, v: 1 },
		]);
		const partial = { scheduledAt: 10, elapsed: 0.25, rate: 2 };
		const straight = new RecordedParam();
		native.fxAutomation.scheduleParamLane(
			[{ param: straight }],
			input,
			"linear",
			partial,
		);
		assert.deepEqual(straight.events, [
			{ kind: "cancel", time: 0 },
			{ kind: "set", value: 0.25, time: 10 },
			{ kind: "ramp", value: 1, time: 10.375 },
		]);
		const curved = new RecordedParam();
		input.points[0].curve = 0.5;
		native.fxAutomation.scheduleParamLane(
			[{ param: curved }],
			input,
			"linear",
			partial,
		);
		assert.equal(curved.events.length, 2);
		assert.deepEqual(curved.events[0], { kind: "cancel", time: 0 });
		const event = curved.events[1];
		assert.equal(event.kind, "curve");
		assert.equal(event.values.length, 38);
		assert.equal(event.values[0], 0.0625);
		assert.equal(event.values.at(-1), 1);
		assert.equal(event.time, 10);
		assert.equal(event.duration, 0.375);
		return {
			straight: straight.events,
			curved: { points: 38, first: 0.0625, last: 1, time: 10, duration: 0.375 },
		};
	});

	check(
		"audio-param-curve-density-mapping-and-holds",
		"native-scheduling",
		() => {
			const counts = [];
			for (const duration of [0.001, 1, 100]) {
				const param = new RecordedParam();
				native.fxAutomation.scheduleParamLane(
					[{ param }],
					lane([
						{ t: 0, v: 0, curve: 0.5 },
						{ t: duration, v: 1 },
					]),
					"linear",
					timing,
				);
				counts.push(param.events[1].values.length);
			}
			assert.deepEqual(counts, [8, 100, 4096]);
			const mapped = new RecordedParam();
			native.fxAutomation.scheduleParamLane(
				[{ param: mapped, map: (value) => 1 - value }],
				lane([
					{ t: 0, v: 0 },
					{ t: 1, v: 1 },
				]),
				"linear",
				timing,
			);
			assert.equal(mapped.events[1].kind, "curve");
			assert.equal(mapped.events[1].values[0], 1);
			assert.equal(mapped.events[1].values.at(-1), 0);
			const logarithmic = new RecordedParam();
			native.fxAutomation.scheduleParamLane(
				[{ param: logarithmic }],
				lane([
					{ t: 0, v: 1 },
					{ t: 1, v: 4 },
				]),
				"log",
				timing,
			);
			assert.equal(logarithmic.events[1].kind, "curve");
			assert.equal(logarithmic.events[1].values.length, 100);
			for (const elapsed of [-1, 2]) {
				const param = new RecordedParam();
				native.fxAutomation.scheduleParamLane(
					[{ param }],
					lane([
						{ t: 0, v: 0.25 },
						{ t: 1, v: 0.75 },
					]),
					"linear",
					{ ...timing, elapsed },
				);
				assert.deepEqual(param.events[1], {
					kind: "set",
					value: elapsed < 0 ? 0.25 : 0.75,
					time: 0,
				});
				assert.equal(param.events.length, elapsed < 0 ? 3 : 2);
			}
			const constant = new RecordedParam();
			native.fxAutomation.scheduleParamLane(
				[{ param: constant }],
				lane([{ t: 4, v: 0.4 }]),
				"linear",
				timing,
			);
			assert.deepEqual(constant.events, [
				{ kind: "cancel", time: 0 },
				{ kind: "set", value: 0.4, time: 0 },
			]);
			const empty = new RecordedParam();
			native.fxAutomation.scheduleParamLane(
				[{ param: empty }],
				lane([]),
				"linear",
				timing,
			);
			assert.deepEqual(empty.events, []);
			return {
				curveCounts: counts,
				mappedLinearUsesCurve: true,
				logUsesCurve: true,
				boundaryAndConstantHolds: true,
			};
		},
	);

	check("rate-native-integral-and-inverse", "native-control-math", () => {
		const rate = {
			target: "rate",
			points: [
				{ t: 0, v: 1 },
				{ t: 1, v: 4 },
			],
		};
		near(native.rate.rateAt(rate, 0.5), 2);
		const half = native.rate.sourceTimeAt(rate, 0.5);
		const whole = native.rate.sourceTimeAt(rate, 1);
		near(half, 0.7213976606025128);
		near(whole, 2.1641929818075383);
		// Analytic integration is deliberately NOT the expected native answer.
		assert.ok(Math.abs(whole - 3 / Math.log(4)) > 0.0001);
		for (const time of [-0.25, 0, 0.01, 0.123, 0.5, 0.999, 1, 1.5]) {
			near(
				native.rate.timeAtSourceTime(
					rate,
					native.rate.sourceTimeAt(rate, time),
				),
				time,
			);
		}
		near(native.rate.sourceTimeAt(rate, -0.25), -0.25);
		near(native.rate.sourceTimeAt(rate, 1.5), whole + 2);
		near(native.rate.sourceTimeAt(2, 0.75), 1.5);
		const shaped = {
			target: "rate",
			points: [
				{ t: 0, v: 1, curve: 0.5 },
				{ t: 1, v: 4 },
			],
		};
		const shifted = native.rate.shiftRateLane(shaped, 0.25);
		assert.equal(shifted.points.length, 17);
		near(shifted.points[0].v, native.rate.rateAt(shaped, 0.25));
		near(shifted.points[1].t, 0.046875);
		near(shifted.points.at(-1).t, 0.75);
		return {
			rateAtHalf: 2,
			sourceAtHalf: half,
			sourceAtOne: whole,
			shiftedShapedPointCount: 17,
			variableRatePcm: "not tested",
		};
	});
}
