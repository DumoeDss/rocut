import { describe, expect, test } from "bun:test";

import { isProgrammaticSource, type ProgrammaticSource } from "../programmatic";

function source(audio?: unknown) {
	return {
		version: 1,
		runtime: "html-document",
		code: "<!doctype html><p>Fixture</p>",
		width: 64,
		height: 64,
		frameRate: { numerator: 30, denominator: 1 },
		durationFrames: 60,
		seed: 1,
		...(audio === undefined ? {} : { audio }),
	};
}

describe("programmatic audio profile transport contract", () => {
	test("accepts absent audio, legacy native, and the explicit graph profile shape", () => {
		expect(isProgrammaticSource(source())).toBe(true);
		expect(isProgrammaticSource(source({ version: 1, mode: "native" }))).toBe(
			true,
		);
		const audio: NonNullable<ProgrammaticSource["audio"]> = {
			version: 1,
			mode: "native",
			profile: "hyperframes-graph-v1",
			muted: false,
			volumeDb: -6,
		};
		// This guard owns the wire shape only. Rust additionally requires a
		// compiled, pinned HyperFrames build and enforces all numeric limits.
		expect(isProgrammaticSource(source(audio))).toBe(true);
		expect(
			isProgrammaticSource(JSON.parse(JSON.stringify(source(audio)))),
		).toBe(true);
	});

	test("rejects malformed or unknown profile declarations without downgrading", () => {
		for (const profile of [
			null,
			"",
			"native",
			"hyperframes-graph-v2",
			"rocut-hyperframes-0.8.139-audio-graph-v1",
			"HYPERFRAMES-GRAPH-V1",
			true,
			1,
			["hyperframes-graph-v1"],
			{ "hyperframes-graph-v1": null },
		]) {
			expect(
				isProgrammaticSource(source({ version: 1, mode: "native", profile })),
			).toBe(false);
		}
	});

	test("keeps the native mode and strict field whitelist for graph audio", () => {
		const audio = {
			version: 1,
			mode: "native",
			profile: "hyperframes-graph-v1",
		};
		expect(
			isProgrammaticSource(source({ ...audio, mode: "hyperframes-graph-v1" })),
		).toBe(false);
		expect(isProgrammaticSource(source({ ...audio, unknown: true }))).toBe(
			false,
		);
		expect(isProgrammaticSource(source({ ...audio, profileVersion: 1 }))).toBe(
			false,
		);
		expect(isProgrammaticSource(source({ ...audio, muted: "false" }))).toBe(
			false,
		);
		expect(isProgrammaticSource(source(null))).toBe(false);
	});
});
