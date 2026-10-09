import { describe, expect, test } from "bun:test";
import {
	ParticleProtocolError,
	parseParticleResponse,
	validateParticleSurfaceResponse,
	type ParticleResponse,
	type ParticleSurfaceResult,
} from "../programmatic/particle-protocol";
import {
	bytes,
	identity,
	parseResponse,
	policy,
	request,
	response,
	result,
	sample,
	triangle,
} from "./particle-protocol-test-support";

describe("particle response protocol", () => {
	test("response correlates all identities, id, version and fixed fields", () => {
		for (const key of Object.keys(identity)) {
			expect(() => parseResponse({ ...response(), [key]: "other" })).toThrow(
				ParticleProtocolError,
			);
		}
		for (const patch of [
			{ id: 2 },
			{ version: 2 },
			{ operation: "eval" },
			{ ok: 1 },
			{ error: {} },
			{ kind: "sample" },
			{ code: "forbidden" },
		])
			expect(() => parseResponse({ ...response(), ...patch })).toThrow(
				ParticleProtocolError,
			);
		const { responseJson: _json, ...without } = response();
		expect(() => parseResponse(without)).toThrow(ParticleProtocolError);
	});

	test("both raw Rust JSON and complete encoded reply have UTF-8 caps", () => {
		const raw = JSON.stringify({
			version: 1,
			ok: false,
			error: { code: "numericRange", path: "surface", message: "失败😀" },
		});
		const json = JSON.stringify(response(raw));
		const exact = {
			...policy,
			maxResponseJsonBytes: bytes(raw),
			maxResponseEnvelopeBytes: bytes(json),
		};
		expect(parseParticleResponse(json, request(), exact).ok).toBe(true);
		expect(() =>
			parseParticleResponse(json, request(), {
				...exact,
				maxResponseEnvelopeBytes: bytes(json) - 1,
			}),
		).toThrow(ParticleProtocolError);
		expect(
			validateParticleSurfaceResponse(raw, request(), {
				...policy,
				maxResponseJsonBytes: bytes(raw),
			}).ok,
		).toBe(false);
		expect(() =>
			validateParticleSurfaceResponse(raw, request(), {
				...policy,
				maxResponseJsonBytes: bytes(raw) - 1,
			}),
		).toThrow(ParticleProtocolError);
	});

	test("transport failures have only fixed codes; Rust errors stay structured", () => {
		const { responseJson: _json, ...common } = response();
		for (const code of ["surface", "protocol", "cancelled"] as const) {
			const value: ParticleResponse = {
				...common,
				ok: false,
				error: { code, message: "Failed" },
			};
			expect(parseResponse(value)).toEqual(value);
		}
		for (const error of [
			{ code: "eval", message: "x" },
			{ code: "surface", message: "" },
			{ code: "surface", message: "x", url: "x" },
		]) {
			expect(() => parseResponse({ ...common, ok: false, error })).toThrow(
				ParticleProtocolError,
			);
		}
		const raw: ParticleSurfaceResult = {
			version: 1,
			ok: false,
			error: { code: "allDegenerate", path: "surface", message: "No area" },
		};
		expect(
			validateParticleSurfaceResponse(JSON.stringify(raw), request(), policy),
		).toEqual(raw);
		for (const patch of [
			{ version: 2 },
			{ samples: [] },
			{ error: { code: "x", message: "x" } },
		]) {
			expect(() =>
				parseResponse(response(JSON.stringify({ ...raw, ...patch }))),
			).toThrow(ParticleProtocolError);
		}
	});

	test("Rust success requires complete sample shape and count/index association", () => {
		for (const patch of [
			{ samples: [] },
			{ samples: [sample(), sample()] },
			{ version: 2 },
			{ ok: null },
			{ error: {} },
		]) {
			expect(() =>
				parseResponse(response(JSON.stringify({ ...result(), ...patch }))),
			).toThrow(ParticleProtocolError);
		}
		for (const patch of [
			{ position: [0, 0] },
			{ normal: null },
			{ barycentric: [0, 0, "1"] },
			{ triangleIndex: 1 },
			{ triangleIndex: -1 },
			{ primitiveIndex: 8 },
			{ uv: [0, 0] },
			{ color: [0, 0, 0, 0] },
			{ materialIndex: 0 },
			{ url: "x" },
		])
			expect(() =>
				parseResponse(
					response(
						JSON.stringify({
							...result(),
							samples: [{ ...sample(), ...patch }],
						}),
					),
				),
			).toThrow(ParticleProtocolError);
		for (const key of Object.keys(sample())) {
			const incomplete: Record<string, unknown> = { ...sample() };
			delete incomplete[key];
			expect(() =>
				parseResponse(
					response(JSON.stringify({ ...result(), samples: [incomplete] })),
				),
			).toThrow(ParticleProtocolError);
		}
	});

	test("mixed optional attributes correlate with source triangle without geometry checks", () => {
		const rich = {
			...triangle,
			primitiveIndex: 0xffff_ffff,
			materialIndex: 0xffff_ffff,
			uv: [
				[0, 0],
				[1, 0],
				[0, 1],
			],
			color: [
				[1, 0, 0, 1],
				[1, 0, 0, 1],
				[1, 0, 0, 1],
			],
		};
		const req = request({ triangles: [triangle, rich], count: 2, seed: 1 });
		const output: Extract<ParticleSurfaceResult, { ok: true }> = {
			version: 1,
			ok: true,
			samples: [
				sample(),
				{
					...sample(),
					triangleIndex: 1,
					primitiveIndex: 0xffff_ffff,
					materialIndex: 0xffff_ffff,
					uv: [0.2, 0.3],
					color: [1, 0, 0, 1],
					normal: [0, 0, 0],
					barycentric: [9, -2, 4],
				},
			],
		};
		expect(
			validateParticleSurfaceResponse(JSON.stringify(output), req, policy),
		).toEqual(output);
		for (const patch of [
			{ materialIndex: 0 },
			{ materialIndex: null },
			{ uv: null },
			{ color: null },
			{ triangleIndex: 0 },
		]) {
			const invalid = {
				...output,
				samples: [sample(), { ...output.samples[1], ...patch }],
			};
			expect(() =>
				validateParticleSurfaceResponse(JSON.stringify(invalid), req, policy),
			).toThrow(ParticleProtocolError);
		}
	});
});
