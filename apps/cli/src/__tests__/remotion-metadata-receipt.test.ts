import { expect, test } from "bun:test";
import { canonicalRemotionMetadataJson } from "../programmatic/remotion-metadata-json";
import {
	createRemotionMetadataReceipt,
	remotionMetadataJsonSha256,
} from "../programmatic/remotion-metadata-receipt";
import {
	REMOTION_METADATA_VALIDATION_SOURCE,
	remotionMetadataValidation,
} from "../programmatic/remotion-metadata-validation";
import type {
	RemotionMetadataBinding,
	RemotionMetadataValidation,
} from "../programmatic/remotion-metadata-contract";

const binding: RemotionMetadataBinding = {
	adapter: { id: "rocut-remotion-html", version: 2, sha256: "a".repeat(64) },
	inspectionRevision: "b".repeat(64),
	toolchainLockSha256: "c".repeat(64),
	compositionId: "Main",
	inputPropsSha256: remotionMetadataJsonSha256({ supplied: 3 }),
	width: 64,
	height: 32,
	durationFrames: 10,
	frameRate: { numerator: 30000, denominator: 1001 },
};
const props = { x: 1, nested: { z: true, a: null }, list: ["first", "second"] };
function fixture() {
	const receipt = createRemotionMetadataReceipt({
		binding,
		returnedProps: props,
	});
	const metadata = {
		compositionId: "Main",
		width: 64,
		height: 32,
		durationFrames: 10,
		fps: 30000 / 1001,
		props: structuredClone(props),
	};
	return { receipt, binding: structuredClone(binding), metadata };
}
// Controlled evaluation of generated adapter code: no browser or authored code.
function runtimeValidation(): RemotionMetadataValidation {
	const evaluate = new Function(
		REMOTION_METADATA_VALIDATION_SOURCE +
			"\nreturn rocutRemotionMetadataValidation;",
	);
	return evaluate();
}
const validators = [remotionMetadataValidation, runtimeValidation()];

test("canonical JSON ignores object key order, preserves arrays and repeated noncyclic objects", () => {
	expect(canonicalRemotionMetadataJson({ b: [2, 1], a: { y: 3, x: 4 } })).toBe(
		canonicalRemotionMetadataJson({ a: { x: 4, y: 3 }, b: [2, 1] }),
	);
	expect(canonicalRemotionMetadataJson([1, 2])).not.toBe(
		canonicalRemotionMetadataJson([2, 1]),
	);
	const repeated = { value: "same" };
	expect(canonicalRemotionMetadataJson([repeated, repeated])).toBe(
		'[{"value":"same"},{"value":"same"}]',
	);
	expect(remotionMetadataJsonSha256({ a: 1, b: 2 })).toBe(
		remotionMetadataJsonSha256({ b: 2, a: 1 }),
	);
	expect(
		canonicalRemotionMetadataJson(Object.assign(Object.create(null), { a: 1 })),
	).toBe('{"a":1}');
});
test("strict JSON rejects actual invalid values rather than JSON.stringify erasing or invoking them", () => {
	const cycle: Record<string, unknown> = {};
	cycle.self = cycle;
	let invoked = 0;
	const getter = Object.defineProperty({}, "x", {
		enumerable: true,
		get() {
			invoked++;
			return 1;
		},
	});
	const hidden = Object.defineProperty({}, "x", { value: 1 });
	const extended = Object.assign([1], { extra: 2 });
	const invalid: unknown[] = [
		undefined,
		NaN,
		Infinity,
		-Infinity,
		1n,
		Symbol("x"),
		() => 1,
		new Date(),
		new Map(),
		new Set(),
		new Uint8Array([1]),
		/x/,
		cycle,
		{ x: undefined },
		{ x: NaN },
		{ x: 1n },
		{ [Symbol("secret")]: 1 },
		getter,
		hidden,
		[undefined],
		new Array(2),
		extended,
	];
	for (const value of invalid) {
		expect(() => canonicalRemotionMetadataJson(value)).toThrow();
		for (const validator of validators) {
			const input = fixture();
			expect(() =>
				validator.assertRuntimeMetadata({
					...input,
					metadata: { ...input.metadata, props: value },
				}),
			).toThrow();
		}
	}
	expect(invoked).toBe(0);
});
test("host receipt snapshots bindings/props and runtime accepts equivalent reordered JSON without changing source props", () => {
	const inputProps = { supplied: 3 },
		returned = structuredClone(props),
		original = structuredClone(binding);
	const receipt = createRemotionMetadataReceipt({
		binding: original,
		returnedProps: returned,
	});
	returned.x = 7;
	original.adapter.sha256 = "d".repeat(64);
	expect(receipt.returnedProps).toEqual(props);
	expect(receipt.adapter.sha256).toBe(binding.adapter.sha256);
	expect(receipt.inputPropsSha256).toBe(remotionMetadataJsonSha256(inputProps));
	for (const validator of validators) {
		const input = fixture();
		input.metadata.props = {
			list: ["first", "second"],
			nested: { a: null, z: true },
			x: 1,
		};
		expect(() => validator.assertRuntimeMetadata(input)).not.toThrow();
		expect(input.metadata.props.list).toEqual(["first", "second"]);
	}
});
test("host and emitted runtime fail exact geometry, props and array-order drift independently", () => {
	for (const validator of validators) {
		for (const patch of [
			{ width: 65 },
			{ height: 33 },
			{ durationFrames: 11 },
			{ fps: 30 },
			{ compositionId: "Other" },
		]) {
			const input = fixture();
			expect(() =>
				validator.assertRuntimeMetadata({
					...input,
					metadata: { ...input.metadata, ...patch },
				}),
			).toThrow("geometry differs");
		}
		for (const changed of [
			{ ...props, x: 2 },
			{ ...props, list: ["second", "first"] },
			{ ...props, extra: true },
		]) {
			const input = fixture();
			expect(() =>
				validator.assertRuntimeMetadata({
					...input,
					metadata: { ...input.metadata, props: changed },
				}),
			).toThrow("props differ");
		}
	}
});
test("receipt schema/version/adapter/source identities fail closed in both implementations", () => {
	for (const validator of validators) {
		for (const patch of [
			{ version: 2 },
			{ extra: true },
			{ returnedProps: [] },
			{ adapter: { ...binding.adapter, version: 1 } },
			{ adapter: { ...binding.adapter, sha256: "D".repeat(64) } },
			{ inspectionRevision: "e".repeat(64) },
			{ toolchainLockSha256: "e".repeat(64) },
			{ inputPropsSha256: "e".repeat(64) },
			{ compositionId: "Other" },
			{ width: 0 },
			{ height: 1.5 },
			{ durationFrames: -1 },
			{ frameRate: { numerator: 30000, denominator: 0 } },
			{ frameRate: { numerator: 60000, denominator: 2002 } },
		]) {
			const input = fixture();
			expect(() =>
				validator.validateReceipt({
					binding: input.binding,
					receipt: { ...input.receipt, ...patch },
				}),
			).toThrow();
		}
		const input = fixture();
		expect(() =>
			validator.validateReceipt({
				binding: { ...input.binding, extra: true },
				receipt: input.receipt,
			}),
		).toThrow("Unknown or missing");
		expect(() =>
			validator.validateReceipt({ binding: input.binding, receipt: null }),
		).toThrow();
	}
});
test("host rejects accessor binding without invoking it and unsupported returned-props shapes", () => {
	let invoked = 0;
	const accessor = Object.defineProperty({ ...binding }, "width", {
		enumerable: true,
		get() {
			invoked++;
			return 64;
		},
	});
	expect(() =>
		createRemotionMetadataReceipt({ binding: accessor, returnedProps: props }),
	).toThrow("non-JSON object property");
	expect(invoked).toBe(0);
	for (const returnedProps of [null, [], undefined, { x: undefined }])
		expect(() =>
			createRemotionMetadataReceipt({ binding, returnedProps }),
		).toThrow();
});
