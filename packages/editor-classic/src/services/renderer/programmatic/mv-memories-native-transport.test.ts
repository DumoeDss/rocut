import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { MV_MEMORIES_NATIVE_FRAMES_SOURCE } from "./mv-memories-native-transport";
test("compiled native replay stays identical to shipped production primitives", () => {
	const source = ["mv-ordered-raster", "mv-ember-raster", "mv-memories-renderer"].map(name => {
		const text = readFileSync(new URL(`./${name}.ts`, import.meta.url), "utf8");
		return text.slice(text.indexOf("String.raw`") + 11, text.lastIndexOf("`;"));
	}).join("\n");
	assert.ok(readFileSync(new URL("./mv-memories-native-replay.ts", import.meta.url), "utf8").includes(source));
});
test("fixed transport rejects a different mapped clock and missing expanded leaves", () => {
	class Bitmap { width = 1920; height = 1080; }
	const factory = runInNewContext(MV_MEMORIES_NATIVE_FRAMES_SOURCE + ";mvMemoriesNativeFrames", { ImageBitmap: Bitmap }) as
		(plan: unknown, packets: unknown, owned: Set<unknown>, check: () => void) => Map<string, { draw(ctx: unknown): void }>;
	const leaf = { kind: "memoriesOwnerRequest", nodeId: "photo", request: { frame: { songTicks: 120000 } } };
	const other = { ...leaf, request: { frame: { songTicks: 240000 } } };
	const plan = { root: { kind: "transition", from: { kind: "ref", input: leaf }, to: other } };
	const packet = { requestKey: JSON.stringify(leaf), bitmap: new Bitmap(), width: 1920, height: 1080, rgbaSha256: "a".repeat(64) };
	assert.throws(() => factory(plan, [packet], new Set(), () => {}), /coverage/);
	assert.throws(() => factory({ root: other }, [packet], new Set(), () => {}), /identity/);
	const owned = new Set();
	const ready = factory({ root: leaf }, [packet], owned, () => {});
	assert.equal(owned.has(packet.bitmap), true);
	let drawn = false;
	ready.get(JSON.stringify(leaf))!.draw({ drawImage(bitmap: unknown) { assert.equal(bitmap, packet.bitmap); drawn = true; } });
	assert.equal(drawn, true);
});
