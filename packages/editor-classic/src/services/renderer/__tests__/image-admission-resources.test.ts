import { beforeEach, expect, mock, test } from "bun:test";
import type {
	ProgrammaticResource,
	ProgrammaticSource,
} from "@opencut/editor-contracts";
import type { ProgrammaticFrame } from "../programmatic/frame";

let response: unknown;
const calls: Uint8Array[] = [];
mock.module("opencut-wasm", () => ({
	inspectProgrammaticImageBytes(input: Uint8Array) {
		calls.push(input.slice());
		return response;
	},
}));
const { prepareImageAdmissions } =
	await import("../programmatic/image-dimensions-resources");
const limits = { maxDimension: 8192, maxDecodedBytes: 128 * 1024 * 1024 };
const geometry = { width: 3, height: 2, decodedBytes: 24, limits };

beforeEach(() => {
	response = JSON.stringify(geometry);
	calls.length = 0;
});

async function fixture() {
	const body = new Uint8Array([11, 22, 33]).buffer;
	const sha256 = [
		...new Uint8Array(await crypto.subtle.digest("SHA-256", body)),
	]
		.map((value) => value.toString(16).padStart(2, "0"))
		.join("");
	const resource: ProgrammaticResource = {
		id: "cover.png",
		kind: "image",
		attachmentKey: `programmatic-sha256-${sha256}`,
		mimeType: "image/png",
		byteLength: body.byteLength,
		sha256,
	};
	const source: ProgrammaticSource = {
		version: 1,
		runtime: "canvas-worker",
		code: "",
		width: 1920,
		height: 1080,
		frameRate: { numerator: 30, denominator: 1 },
		durationFrames: 30,
		seed: 0,
		resources: [resource],
	};
	const frame: ProgrammaticFrame = {
		index: 0,
		time: 0,
		timelineTime: 0,
		sourceTime: 0,
		frameRate: source.frameRate,
		durationFrames: source.durationFrames,
		seed: 0,
		imageDecodeLimits: limits,
		imageDimensionRequests: [{ resource }],
	};
	return {
		source,
		frame,
		resources: [{ resource, body }],
		sequenceImages: [],
		operation: "measure-resources" as const,
	};
}

test("verified bytes use the binary inspector envelope and semantic request identity", async () => {
	const input = await fixture();
	const original = input.resources[0].resource;
	// Rust's serialized field order need not match the original author object.
	input.frame = {
		...input.frame,
		imageDimensionRequests: [
			{
				resource: {
					sha256: original.sha256,
					byteLength: original.byteLength,
					mimeType: original.mimeType,
					attachmentKey: original.attachmentKey,
					kind: original.kind,
					id: original.id,
				},
			},
		],
	};
	expect(await prepareImageAdmissions(input)).toEqual([
		{ resource: original, width: 3, height: 2, decodedBytes: 24 },
	]);
	expect(calls).toHaveLength(1);
	const bytes = calls[0];
	const size = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true);
	expect(
		JSON.parse(new TextDecoder().decode(bytes.slice(4, 4 + size))),
	).toEqual({ mimeType: "image/png" });
	expect([...bytes.slice(4 + size)]).toEqual([11, 22, 33]);
});

test("invalid inspector transport, shapes and limits never become allocation facts", async () => {
	const input = await fixture();
	const invalid: unknown[] = [
		undefined,
		42,
		{},
		"not-json",
		"null",
		"[]",
		"{}",
		...[
			{ error: "bad image" },
			{ ...geometry, width: "3" },
			{ ...geometry, width: 0 },
			{ ...geometry, height: -1 },
			{ ...geometry, width: 3.5 },
			{ ...geometry, decodedBytes: 23 },
			{ ...geometry, limits: null },
			{ ...geometry, limits: [] },
			{ ...geometry, limits: { ...limits, maxDimension: "8192" } },
			{ ...geometry, limits: { ...limits, maxDimension: 1.5 } },
			{ ...geometry, limits: { ...limits, maxDecodedBytes: 0 } },
			{ ...geometry, width: 8193, decodedBytes: 8193 * 2 * 4 },
			{ ...geometry, limits: { ...limits, maxDecodedBytes: 23 } },
			{ ...geometry, limits: { ...limits, maxDimension: 4096 } },
		].map((value) => JSON.stringify(value)),
	];
	for (const value of invalid) {
		response = value;
		await expect(prepareImageAdmissions(input)).rejects.toThrow();
	}
	expect(calls).toHaveLength(invalid.length);
});

test("corrupt digests and mismatched requests fail before invoking the inspector", async () => {
	const input = await fixture();
	new Uint8Array(input.resources[0].body)[0] = 99;
	await expect(prepareImageAdmissions(input)).rejects.toThrow(
		"digest mismatch",
	);
	expect(calls).toHaveLength(0);
	const other = await fixture();
	other.frame = {
		...other.frame,
		imageDimensionRequests: [
			{
				resource: {
					...other.resources[0].resource,
					id: "undeclared.png",
				},
			},
		],
	};
	await expect(prepareImageAdmissions(other)).rejects.toThrow(
		"does not match declaration",
	);
	expect(calls).toHaveLength(0);
});
