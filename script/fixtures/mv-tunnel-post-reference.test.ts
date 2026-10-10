import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createContext, Script } from "node:vm";
import test from "node:test";
import {
	extractTunnelMainFunctions,
	loadTunnelPostReference,
	TUNNEL_MAIN_SHA256,
} from "./mv-tunnel-post-reference";
import { tunnelMainHarness } from "./mv-tunnel-browser-oracle";

const root =
	"E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/vocaloid-style-mv-pipeline";
interface OriginalTestEngine {
	clock: unknown;
	sectionAt?: unknown;
	globalFX?: unknown;
	typo: { post: { tunnel(sample: unknown): Record<string, unknown> } };
	makeClock(beats: number[], bpm: number, downbeat: number): unknown;
	__tunnelMainReference: {
		stateFor(shot: unknown, time: number): Record<string, unknown>;
		postFor(shot: unknown, time: number): Record<string, number>;
	};
}
test("complete main byte pin and AST slices retain unchanged original declarations", async () => {
	const reference = await loadTunnelPostReference(root);
	assert.equal(reference.main.sha256, TUNNEL_MAIN_SHA256);
	assert.equal(
		createHash("sha256").update(reference.main.code).digest("hex"),
		TUNNEL_MAIN_SHA256,
	);
	assert.deepEqual(
		reference.functions.map((f) => f.name),
		["stateFor", "postFor"],
	);
	for (const f of reference.functions) {
		assert.equal(f.code, reference.main.code.slice(f.start, f.end));
		assert.equal(f.sha256, createHash("sha256").update(f.code).digest("hex"));
	}
	assert.deepEqual(
		extractTunnelMainFunctions(reference.main.code),
		reference.functions,
	);
	assert.throws(
		() =>
			tunnelMainHarness({
				...reference,
				functions: reference.functions.map((f, i) =>
					i === 1
						? { ...f, code: f.code.replace("P.boilSeed", "P.changedSeed") }
						: f,
				),
			}),
		/identity/,
	);
	assert.throws(
		() => extractTunnelMainFunctions("function stateFor(){}"),
		/exactly/,
	);
});
test("main postFor calls original typo tunnelPost with the live shot clock", async () => {
	const reference = await loadTunnelPostReference(root);
	const window: { Z?: OriginalTestEngine } = {};
	const realm = createContext({ window });
	for (const id of ["core/util.js", "scenes/typo.js"])
		new Script(
			await readFile(
				join(root, "skills/vocaloid-style-mv/template/engine", id),
				"utf8",
			),
		).runInContext(realm);
	new Script(tunnelMainHarness(reference)).runInContext(realm);
	const Z = window.Z;
	assert.ok(Z);
	const shot = {
		id: "tunnel-original-post",
		t0: 200,
		t1: 205,
		args: {},
		post: (S: unknown) => Z.typo.post.tunnel(S),
	};
	Z.clock = Z.makeClock([200, 201.5, 202], 120, 0);
	const result = Z.__tunnelMainReference.postFor(shot, 201.5);
	const dedicated = Z.typo.post.tunnel(
		Z.__tunnelMainReference.stateFor(shot, 201.5),
	);
	for (const [key, value] of Object.entries(dedicated))
		assert.deepEqual(result[key], value);
	assert.equal(result.boilSeed, 424);
	assert.equal(result.grainSeed, 800);
	assert.equal(result.glitchSeed, 89);
	Z.clock = Z.makeClock([200], 120, 0);
	assert.ok(
		Z.__tunnelMainReference.postFor(shot, 201.5).zoomBlur < result.zoomBlur,
	);
});
test("original postFor produces boundary seeds and uses each frame's original makeClock", async () => {
	const reference = await loadTunnelPostReference(root);
	const window: { Z?: OriginalTestEngine } = {};
	const realm = createContext({ window });
	const util = await readFile(
		join(root, "skills/vocaloid-style-mv/template/engine/core/util.js"),
		"utf8",
	);
	new Script(util).runInContext(realm);
	new Script(tunnelMainHarness(reference)).runInContext(realm);
	const Z = window.Z;
	assert.ok(Z);
	const args = { words: ["猫"] };
	const shot = {
		id: "dedicated-tunnel",
		t0: 1,
		t1: 3,
		args,
		post: (S: Record<string, unknown>) => {
			assert.equal(S.clock, Z.clock);
			assert.equal(S.W, 1920);
			assert.equal(S.H, 1080);
			assert.equal(S.section, null);
			assert.equal(S.args, args);
			return { bloom: 0.4, beatBloom: 0.2, ca: 0.1, beatCA: 0.3, boilFps: 12 };
		},
	};
	Z.clock = Z.makeClock([0, 0.5, 1], 120, 0);
	const samples = [
		[0, 0, 0, 0],
		[1 / 24 - 1e-6, 0, 0, 0],
		[1 / 24, 0, 1, 1],
		[1 / 12 - 1e-6, 0, 1, 1],
		[1 / 12, 1, 2, 2],
		[1009 / 24, 504, 0, 100],
	];
	for (const [time, boil, grain, glitch] of samples) {
		const result = Z.__tunnelMainReference.postFor(shot, time);
		assert.equal(result.boilSeed, boil);
		assert.equal(result.grainSeed, grain);
		assert.equal(result.glitchSeed, glitch);
	}
	const state = Z.__tunnelMainReference.stateFor(shot, 0);
	assert.equal(state.p, 0);
	assert.equal(state.lt, -1);
	assert.equal(state.dur, 2);
	assert.equal(Z.__tunnelMainReference.stateFor(shot, 4).p, 1);
	const onBeat = Z.__tunnelMainReference.postFor(shot, 1);
	assert.equal(onBeat.ca, 0.4);
	assert.equal(onBeat.bloom, 0.6000000000000001);
	Z.clock = Z.makeClock([0], 120, 0);
	const oldBeat = Z.__tunnelMainReference.postFor(shot, 1);
	assert.ok(oldBeat.ca < 0.101);
	assert.ok(oldBeat.bloom < 0.401);
	assert.equal(Z.sectionAt, undefined);
	assert.equal(Z.globalFX, undefined);
});
