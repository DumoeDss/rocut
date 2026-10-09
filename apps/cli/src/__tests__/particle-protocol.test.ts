import { describe, expect, test } from "bun:test";
import {
	PARTICLE_BINDING_NAME,
	PARTICLE_REPLY_NAME,
	ParticleProtocolError,
	parseParticleRequest,
	validateParticlePolicy,
	validateParticleSurfaceResponse,
	type ParticlePolicy,
} from "../programmatic/particle-protocol";
import {
	bytes,
	identity,
	parseRequest,
	parseResponse,
	policy,
	request,
	response,
	result,
	surface,
	triangle,
} from "./particle-protocol-test-support";

describe("particle transport protocol", () => {
	test("fixed operation sample round-trip preserves Rust JSON exactly", () => {
		const value = request();
		value.requestJson = `  ${value.requestJson}\n`;
		expect(parseRequest(value)).toEqual(value);
		expect(parseResponse(response())).toEqual(response());
		expect(
			validateParticleSurfaceResponse(JSON.stringify(result()), value, policy),
		).toEqual(result());
		expect(PARTICLE_BINDING_NAME).toBe("__rocutParticleSurface");
		expect(PARTICLE_REPLY_NAME).toBe("__rocutParticleSurfaceReply");
	});

	test("cancel is narrow; replay and active-job ownership are broker concerns", () => {
		const { requestJson: _json, ...value } = request();
		const cancel = { ...value, kind: "cancel" as const };
		expect(parseRequest(cancel)).toEqual(cancel);
		expect(parseRequest(cancel)).toEqual(cancel);
		expect(() => parseRequest({ ...cancel, requestJson: "{}" })).toThrow(
			ParticleProtocolError,
		);
		expect(() => parseRequest({ ...cancel, targetId: 2 })).toThrow(
			ParticleProtocolError,
		);
	});

	test("rejects unknown versions, operations, kinds and privileged fields", () => {
		for (const patch of [
			{ version: 2 },
			{ version: "1" },
			{ operation: "evaluate" },
			{ operation: "fetch" },
			{ kind: "notify" },
			{ method: "eval" },
			{ url: "https://invalid.test" },
			{ file: "C:/private" },
			{ code: "throw 1" },
			{ grantId: "forged" },
		])
			expect(() => parseRequest({ ...request(), ...patch })).toThrow(
				ParticleProtocolError,
			);
		for (const key of Object.keys(request())) {
			const value: Record<string, unknown> = { ...request() };
			delete value[key];
			expect(() => parseRequest(value)).toThrow(ParticleProtocolError);
		}
	});

	test("all capture identities and positive safe ids must match", () => {
		for (const key of Object.keys(identity)) {
			for (const value of ["", "other", 1, null, "\ud800"]) {
				expect(() => parseRequest({ ...request(), [key]: value })).toThrow(
					ParticleProtocolError,
				);
			}
		}
		for (const id of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, null, "1"]) {
			expect(() => parseRequest({ ...request(), id })).toThrow(
				ParticleProtocolError,
			);
		}
		expect(parseRequest({ ...request(), id: Number.MAX_SAFE_INTEGER }).id).toBe(
			Number.MAX_SAFE_INTEGER,
		);
	});

	test("accepts only JSON strings and rejects malformed JSON before use", () => {
		for (const json of [
			"",
			"{",
			"null",
			"[]",
			"true",
			"1",
			"{}",
			"\ufeff{}",
			"{}\ud800",
		]) {
			expect(() => parseParticleRequest(json, identity, policy)).toThrow(
				ParticleProtocolError,
			);
		}
		expect(() =>
			parseParticleRequest(request() as unknown as string, identity, policy),
		).toThrow(ParticleProtocolError);
		for (const requestJson of ["{", "null", "[]", "{}", 1]) {
			expect(() => parseRequest({ ...request(), requestJson })).toThrow(
				ParticleProtocolError,
			);
		}
	});

	test("explicit policy requires every numeric cap and nested process policy", () => {
		expect(() => validateParticlePolicy(policy)).not.toThrow();
		for (const key of Object.keys(policy)) {
			for (const value of [
				0,
				-1,
				0.5,
				NaN,
				Infinity,
				Number.MAX_SAFE_INTEGER + 1,
			]) {
				expect(() =>
					validateParticlePolicy({ ...policy, [key]: value }),
				).toThrow(ParticleProtocolError);
			}
			const missing = { ...policy } as Record<string, unknown>;
			delete missing[key];
			expect(() => validateParticlePolicy(missing as ParticlePolicy)).toThrow(
				ParticleProtocolError,
			);
		}
		expect(() => validateParticlePolicy({ ...policy, maxInFlight: 5 })).toThrow(
			ParticleProtocolError,
		);
		expect(() =>
			validateParticlePolicy({ ...policy, maxTotalBytes: 5 } as ParticlePolicy),
		).toThrow(ParticleProtocolError);
	});

	test("UTF-8 request cap covers complete envelope, escapes and multibyte identity", () => {
		const expected = { ...identity, sourceId: "源é😀" };
		const json = JSON.stringify({ ...request(), ...expected });
		const exact = {
			...policy,
			maxRequestJsonBytes: bytes(request().requestJson),
			maxRequestEnvelopeBytes: bytes(json),
		};
		expect(bytes(json)).toBeGreaterThan(json.length);
		expect(parseParticleRequest(json, expected, exact).sourceId).toBe(
			expected.sourceId,
		);
		expect(() =>
			parseParticleRequest(json, expected, {
				...exact,
				maxRequestEnvelopeBytes: exact.maxRequestEnvelopeBytes - 1,
			}),
		).toThrow(ParticleProtocolError);
		const escaped = JSON.stringify({
			...request(),
			requestJson: " ".repeat(4096),
		});
		expect(() => parseParticleRequest(escaped, identity, policy)).toThrow(
			ParticleProtocolError,
		);
	});

	test("request budgets and Rust numeric wire widths are independently checked", () => {
		for (const patch of [
			{ count: 0 },
			{ count: 4 },
			{ count: 1.2 },
			{ count: 0x1_0000_0000 },
			{ seed: -1 },
			{ seed: 0x1_0000_0000 },
			{ seed: 0.5 },
			{ triangles: [] },
			{ triangles: Array(4).fill(triangle) },
		])
			expect(() => parseRequest(request({ ...surface(), ...patch }))).toThrow(
				ParticleProtocolError,
			);
		expect(
			parseRequest(request({ ...surface(), seed: 0xffff_ffff })),
		).toBeDefined();
		for (const primitiveIndex of [-1, 0.1, 0x1_0000_0000, null, "7"]) {
			expect(() =>
				parseRequest(
					request({
						...surface(),
						triangles: [{ ...triangle, primitiveIndex }],
					}),
				),
			).toThrow(ParticleProtocolError);
		}
	});

	test("rejects unexpected or malformed nested triangle fields", () => {
		for (const patch of [
			{ position: [] },
			{
				position: [
					[0, 0, 0],
					[1, 0, 0],
				],
			},
			{
				position: [
					[0, 0, "0"],
					[1, 0, 0],
					[0, 1, 0],
				],
			},
			{ normal: [[0, 0, 1]] },
			{
				uv: [
					[0, 0, 0],
					[0, 0, 0],
					[0, 0, 0],
				],
			},
			{ color: [null, null, null] },
			{ materialIndex: -1 },
			{ code: "eval" },
		])
			expect(() =>
				parseRequest(
					request({ ...surface(), triangles: [{ ...triangle, ...patch }] }),
				),
			).toThrow(ParticleProtocolError);
		expect(() =>
			parseRequest(request({ ...surface(), triangles: [triangle, null] })),
		).toThrow(ParticleProtocolError);
		expect(() =>
			parseRequest(request({ ...surface(), url: "forbidden" })),
		).toThrow(ParticleProtocolError);
		const nonFinite = request();
		nonFinite.requestJson = nonFinite.requestJson.replace(
			"[0,0,0]",
			"[1e400,0,0]",
		);
		expect(() => parseRequest(nonFinite)).toThrow(ParticleProtocolError);
	});

	test("geometry decisions remain Rust-owned; request null Options are valid wire", () => {
		const degenerate = {
			position: [
				[1e200, 0, 0],
				[1e200, 0, 0],
				[1e200, 0, 0],
			],
			normal: [
				[0, 0, 0],
				[0, 0, 0],
				[0, 0, 0],
			],
			color: [
				[2, -1, 3, 4],
				[2, -1, 3, 4],
				[2, -1, 3, 4],
			],
			uv: null,
			materialIndex: null,
			primitiveIndex: 0xffff_ffff,
		};
		expect(
			parseRequest(request({ ...surface(), triangles: [degenerate] })),
		).toBeDefined();
		expect(
			parseRequest(
				request({
					...surface(),
					triangles: [{ ...triangle, normal: null, color: null }],
				}),
			),
		).toBeDefined();
	});
});
