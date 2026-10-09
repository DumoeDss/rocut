import { expect, test } from "bun:test";
import {
	parseParticleRequest,
	validateParticleSurfaceResponse,
} from "../programmatic/particle-protocol";
import {
	identity,
	policy,
	request,
	result,
} from "./particle-protocol-test-support";
import { data, motion } from "./particle-c3-test-support";

const parse = (value: unknown) =>
	parseParticleRequest(JSON.stringify(request(value)), identity, policy);

test("optional motion preserves legacy wire shape and admits the frozen motion schema", () => {
	const legacy = data();
	delete legacy.motion;
	expect(parse(legacy).kind).toBe("sample");
	expect(parse(data()).kind).toBe("sample");
});

for (const [name, candidate] of [
	["null", null],
	["array", []],
	["version", { ...motion(), version: 2 }],
	["author seed", { ...motion(), seed: 42 }],
	["author time alias", { ...motion(), time: 0.4 }],
	["unsafe time", { ...motion(), timeTicks: Number.MAX_SAFE_INTEGER + 1 }],
	["negative time", { ...motion(), timeTicks: -1 }],
	["fractional duration", { ...motion(), returnDurationTicks: 0.5 }],
	["string duration", { ...motion(), scatterDurationTicks: "12000" }],
	["null drift", { ...motion(), driftAmplitude: null }],
] as const) {
	test(`motion wire rejects ${name}`, () => {
		expect(() => parse(data({ motion: candidate }))).toThrow();
	});
}

for (const key of Object.keys(motion())) {
	test(`motion wire requires ${key}`, () => {
		const candidate: Record<string, unknown> = { ...motion() };
		delete candidate[key];
		expect(() => parse(data({ motion: candidate }))).toThrow();
	});
}

// These are wire-shape fixtures only. They do not assert a motion algorithm or
// substitute for the new Rust motion package's independent numerical tests.
const response = (changes: Record<string, unknown> = {}) => {
	const value = result();
	return JSON.stringify({
		...value,
		samples: [
			{
				...value.samples[0],
				motionPosition: [0.2, 0.3, 0.4],
				size: 1,
				...changes,
			},
		],
	});
};

test("motion response requires the exact pair of extra fields, preserving the base association", () => {
	const parsed = validateParticleSurfaceResponse(
		response(),
		request(data()),
		policy,
	);
	expect(parsed.ok).toBe(true);
	if (!parsed.ok) throw Error("Expected schema success");
	expect(parsed.samples[0].position).toEqual(result().samples[0].position);
	expect(parsed.samples[0].primitiveIndex).toBe(7);
});

for (const [name, changes] of [
	["missing motion position", { motionPosition: undefined }],
	["missing size", { size: undefined }],
	["null motion position", { motionPosition: null }],
	["wrong vector length", { motionPosition: [0, 0] }],
	["null vector component", { motionPosition: [0, null, 0] }],
	["zero size", { size: 0 }],
	["negative size", { size: -1 }],
	["string size", { size: "1" }],
	["wrong association", { primitiveIndex: 8 }],
] as const) {
	test(`motion response rejects ${name}`, () => {
		expect(() =>
			validateParticleSurfaceResponse(
				response(changes),
				request(data()),
				policy,
			),
		).toThrow();
	});
}

for (const changes of [
	{ motionPosition: undefined },
	{ size: undefined },
	{},
]) {
	test(`legacy response forbids motion attributes ${Object.keys(changes).join("/") || "both"}`, () => {
		const legacy = data();
		delete legacy.motion;
		expect(() =>
			validateParticleSurfaceResponse(
				response(changes),
				request(legacy),
				policy,
			),
		).toThrow("motion attribute presence");
	});
}

test("motion additions are covered by the existing full response JSON budget", () => {
	const raw = response();
	const narrowed = {
		...policy,
		maxResponseJsonBytes: Buffer.byteLength(raw, "utf8") - 1,
	};
	expect(() =>
		validateParticleSurfaceResponse(raw, request(data()), narrowed),
	).toThrow("UTF-8 byte limit");
});
