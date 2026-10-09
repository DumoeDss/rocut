import { expect, test } from "bun:test";
import {
	isProgrammaticBuild,
	type ProgrammaticBuild,
} from "../programmatic-build";

function build(engine = "three") {
	const input = (id: string) => ({
		id,
		kind: "source",
		mimeType: "application/octet-stream",
		byteLength: 0,
		sha256: "a".repeat(64),
		attachmentKey: `programmatic-source-sha256-${"a".repeat(64)}`,
	});
	return {
		version: 1,
		engine,
		engineVersion: "0.185.1",
		entryFile: "scene.ts",
		inputs: [input("scene.ts")],
		toolchainLock: input("_rocut/toolchain-lock.json"),
	};
}

test("plain builds require no particle capability", () => {
	for (const engine of ["three", "hyperframes", "remotion"])
		expect(isProgrammaticBuild(build(engine))).toBe(true);
});

test("explicit particle capability survives a portable JSON roundtrip", () => {
	const capabilities: NonNullable<ProgrammaticBuild["capabilities"]> = [
		"particle-surface-v1",
	];
	const declared = { ...build(), capabilities };
	expect(isProgrammaticBuild(declared)).toBe(true);
	expect(isProgrammaticBuild(JSON.parse(JSON.stringify(declared)))).toBe(true);
});

test("malformed, empty, duplicate and unknown capabilities fail closed", () => {
	for (const capabilities of [
		null,
		false,
		1,
		"particle-surface-v1",
		{ "particle-surface-v1": true },
		[],
		[null],
		[1],
		["particle-surface-v2"],
		["Particle-surface-v1"],
		["particle-surface-v1", "particle-surface-v1"],
		["particle-surface-v1", "unknown"],
	])
		expect(isProgrammaticBuild({ ...build(), capabilities })).toBe(false);
});

test("particle capabilities are Three-only and do not weaken the whitelist", () => {
	for (const engine of ["hyperframes", "remotion"])
		expect(
			isProgrammaticBuild({
				...build(engine),
				capabilities: ["particle-surface-v1"],
			}),
		).toBe(false);
	expect(
		isProgrammaticBuild({
			...build(),
			capabilities: ["particle-surface-v1"],
			samplerPath: "untrusted.wasm",
		}),
	).toBe(false);
});
