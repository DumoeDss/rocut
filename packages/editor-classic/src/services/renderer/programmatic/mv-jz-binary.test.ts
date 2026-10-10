import { test } from "node:test";
import assert from "node:assert/strict";
import { readJzNativeBytes } from "./mv-jz-binary";

const font = {
	id: "font",
	kind: "font" as const,
	attachmentKey: "font-key",
	mimeType: "font/ttf",
	byteLength: 3,
	sha256: "a".repeat(64),
	font: { family: "Physical Font", style: "normal" as const, weight: 500 },
};

test("JZ binary binding accepts Rust's omitted default axes without changing bytes", () => {
	const body = Uint8Array.of(1, 2, 3).buffer;
	const authored = { ...font, font: { ...font.font, axes: {} } };
	assert.deepEqual(
		readJzNativeBytes({
			resources: [{ resource: authored, body }],
			resource: font,
		}),
		Uint8Array.of(1, 2, 3),
	);
	assert.equal(
		readJzNativeBytes({
			resources: [{ resource: font, body }],
			resource: authored,
		}).buffer,
		body,
	);
	assert.equal(
		readJzNativeBytes({
			resources: [{ resource: font, body }],
			resource: {
				...font,
				font: { ...font.font, axes: Object.create(null) },
			},
		}).buffer,
		body,
	);
});

test("JZ binary binding still rejects changed descriptors, duplicate matches and bad lengths", () => {
	const body = new ArrayBuffer(3);
	const input = [{ resource: font, body }];
	for (const changed of [
		{ ...font, id: "other" },
		{ ...font, sha256: "b".repeat(64) },
		{ ...font, attachmentKey: "other" },
		{ ...font, mimeType: "other" },
		{ ...font, byteLength: 2 },
		{ ...font, font: { ...font.font, weight: 400 } },
		{ ...font, font: { ...font.font, axes: { wght: 500 } } },
		{ ...font, unknown: true },
	])
		assert.throws(
			() => readJzNativeBytes({ resources: input, resource: changed }),
			/exact binary descriptor/,
		);
	assert.throws(
		() =>
			readJzNativeBytes({ resources: [...input, ...input], resource: font }),
		/exact binary descriptor/,
	);
	assert.throws(
		() =>
			readJzNativeBytes({
				resources: [{ resource: font, body: new ArrayBuffer(2) }],
				resource: font,
			}),
		/exact binary descriptor/,
	);
	for (const axes of [new Map(), new Date(0)]) {
		const invalid = { ...font, font: { ...font.font, axes: {} } };
		Reflect.set(invalid.font, "axes", axes);
		assert.throws(
			() => readJzNativeBytes({ resources: input, resource: invalid }),
			/exact binary descriptor/,
		);
	}
	const controller = new AbortController();
	controller.abort(Error("cancelled"));
	assert.throws(
		() =>
			readJzNativeBytes({
				resources: input,
				resource: font,
				signal: controller.signal,
			}),
		/cancelled/,
	);
});
