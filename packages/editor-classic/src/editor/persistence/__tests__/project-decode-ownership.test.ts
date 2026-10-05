import { expect, test } from "bun:test";
import { decodeProject } from "../project-codec";
import {
	motionTextSequenceFixture,
	projectFixture,
	recordFixture,
} from "../../transactions/opencut/__tests__/fixture";

function objects({
	value,
	seen = new Set<object>(),
}: {
	value: unknown;
	seen?: Set<object>;
}): Set<object> {
	if (typeof value !== "object" || value === null || seen.has(value))
		return seen;
	seen.add(value);
	if (value instanceof Map) {
		for (const [key, entry] of value) {
			objects({ value: key, seen });
			objects({ value: entry, seen });
		}
	} else if (value instanceof Set) {
		for (const entry of value) objects({ value: entry, seen });
	} else {
		for (const key of Reflect.ownKeys(value))
			objects({ value: Reflect.get(value, key), seen });
	}
	return seen;
}

test("decoding borrows its input but returns no mutable input references", () => {
	const project = projectFixture();
	const sequence = motionTextSequenceFixture();
	const extension = {
		values: new Map([["entry", { bytes: new Uint8Array([1, 2]) }]]),
	};
	Reflect.set(sequence, "futureExtension", extension);
	project.motionTextSequences.push(sequence);
	const record = recordFixture(project);
	const before = structuredClone(record);
	const first = decodeProject(record.data);
	const inputs = objects({ value: record.data });
	for (const value of objects({ value: first }))
		expect(inputs.has(value)).toBe(false);
	first.scenes[0].createdAt.setFullYear(2000);
	first.settings.canvasSize.width = 5;
	Reflect.set(first.motionTextSequences[0].cues[0], "text", "caller mutation");
	expect(record).toEqual(before);
	expect(decodeProject(record.data)).toEqual(project);
});

test("unvalidated scalar slots do not accidentally expose object references", () => {
	const project = projectFixture();
	const duration = { unexpected: [1] };
	const version = { unexpected: [2] };
	// Codec isolation is independent of the domain validator accepting a project.
	Reflect.set(project.metadata, "duration", duration);
	Reflect.set(project, "version", version);
	const decoded = decodeProject(project);
	expect(decoded.metadata.duration).toEqual(duration);
	expect(decoded.version).toEqual(version);
	expect(decoded.metadata.duration).not.toBe(duration);
	expect(decoded.version).not.toBe(version);
});
