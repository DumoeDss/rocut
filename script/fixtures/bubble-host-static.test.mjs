import assert from "node:assert/strict";
import { test } from "node:test";
import { inflateSync } from "node:zlib";
import { bubbleHostAtomicBatch, bubbleHostClips, bubbleHostInvalidCases } from "./bubble-host-cases.mjs";
import { assertBubbleHostAuthored, assertBubbleHostCatalog } from "./bubble-host-checks.mjs";
import { bubbleHostAnimated, bubbleHostFields, bubbleHostId, bubbleHostParams,
	bubbleHostSentinel, bubbleHostSettings, bubbleHostTargetIds } from "./bubble-host-contract.mjs";
import { assertBubbleHostPrivatePath, assertBubbleHostSource, bubbleHostOwnedFiles } from "./bubble-host-paths.mjs";
import { bubbleHostDigest, bubbleHostImage, loadBubbleHostAuthor } from "./bubble-host-source.mjs";

const image = { id: "bubble.png", kind: "image", mimeType: "image/png", attachmentKey: "fixture-only",
	byteLength: bubbleHostImage().length, sha256: bubbleHostDigest(bubbleHostImage()) };
const synthetic = (sixteen = false) => ({ source: { ...bubbleHostSettings, resources: [structuredClone(image)] },
	effects: [{ id: bubbleHostId, type: "bubble", enabled: true, params: { ...bubbleHostParams,
		pointCount: sixteen ? 16 : 2, ...Object.fromEntries(Array.from({ length: sixteen ? 16 : 2 }, (_, index) =>
			[[`point${index}Time`, index * (sixteen ? 8000 : 120000)], [`point${index}X`, 0.5], [`point${index}Y`, 0.5]]).flat()) } }],
	animations: {} });
const shots = { staticShot: synthetic(), animatedShot: synthetic(), sixteenShot: synthetic(true) };
shots.animatedShot.animations = Object.fromEntries(Object.entries(bubbleHostAnimated).map(([key, values]) =>
	[`effects.${bubbleHostId}.params.${key}`, { keys: values.map((value, index) => ({ id: `${key}-${index}`,
		time: index * 180000, value, segmentToNext: "linear", tangentMode: "auto" })) }]));
const clips = () => bubbleHostClips(shots);

test("independent Bubble contract has 76 fields and exactly 21 optical channels", () => {
	assert.equal(bubbleHostFields.length, 76);
	assert.equal(bubbleHostFields.filter((field) => field.keyframable).length, 21);
	assert.equal(Object.keys(bubbleHostParams).length, 27);
	assert.deepEqual(Object.keys(bubbleHostAnimated), bubbleHostFields.filter((f) => f.keyframable).map((f) => f.key));
	const catalog = { effects: { bubble: structuredClone(bubbleHostFields) } };
	assert.doesNotThrow(() => assertBubbleHostCatalog(catalog));
	for (const key of ["type", "min", "max", "step", "default", "keyframable", "required"]) {
		const changed = structuredClone(catalog); changed.effects.bubble[0][key] = "incorrect";
		assert.throws(() => assertBubbleHostCatalog(changed));
	}
	catalog.effects.bubble.pop(); assert.throws(() => assertBubbleHostCatalog(catalog));
});
test("five independent clips preserve static optical keys disabled and sixteen-knot states", () => {
	const before = structuredClone(shots), items = clips(); assert.equal(items.length, 5);
	assert.deepEqual(items[0].editing.animations, {});
	assert.equal(Object.keys(items[1].editing.animations).length, 21);
	assert.equal(items[2].editing.effects[0].enabled, false);
	assert.equal(items[3].editing.effects[0].params.pointCount, 16);
	assert.equal(items[3].editing.effects[0].params.point15Time, 120000);
	assert.deepEqual(items[4].editing.effects, []); assert.deepEqual(items[4].editing.animations, {});
	assert.notEqual(items[4].trackId, items[0].trackId); assert.deepEqual(shots, before);
});
test("192 invalid candidates cover four owning states without mutating originals", () => {
	const items = clips(), before = structuredClone(items), cases = bubbleHostInvalidCases(items);
	assert.equal(cases.length, 192); assert.equal(new Set(cases.map((item) => item.label)).size, 192);
	for (const id of bubbleHostTargetIds) {
		const group = cases.filter((item) => item.clipId === id); assert.equal(group.length, 48);
		assert.equal(group.filter((item) => item.label.includes(":missing-fallback-")).length, 21);
		assert.equal(group.filter((item) => item.label.includes(":static-channel-")).length, 11);
		assert.equal(group.filter((item) => item.label.includes(":animation-")).length, 7);
		for (const item of group) assert.equal(item.editing.effects[0].enabled, id !== "bubble-disabled");
	}
	assert.deepEqual(items, before);
});
test("each negative transaction has valid sentinel first and invalid target second", () => {
	const items = clips(), sentinel = items.find((item) => item.id === bubbleHostSentinel), before = structuredClone(sentinel);
	for (const invalid of bubbleHostInvalidCases(items)) {
		const batch = bubbleHostAtomicBatch({ invalid, sentinel }); assert.equal(batch.length, 2);
		assert.equal(batch[0].clipId, sentinel.id); assert.notEqual(batch[0].patch.editing.name, sentinel.editing.name);
		assert.equal(batch[1].clipId, invalid.clipId); assert.deepEqual(batch[1].patch.editing, invalid.editing);
	}
	assert.deepEqual(sentinel, before);
});
test("authored-state comparison detects parameter track resource and sentinel drift", () => {
	const items = clips(), snapshot = { clips: structuredClone(items), tracks: [], revision: 1 };
	assert.doesNotThrow(() => assertBubbleHostAuthored({ snapshot, clips: items }));
	for (const mutate of [
		(state) => { state.clips[0].editing.effects[0].params.radius = 0; },
		(state) => { state.clips[1].editing.animations = {}; },
		(state) => { state.clips[2].editing.effects[0].enabled = true; },
		(state) => { delete state.clips[3].editing.effects[0].params.point15Y; },
		(state) => { state.clips[0].editing.programmatic.resources = []; },
		(state) => { state.clips[4].editing.name = "partial transaction leak"; },
	]) {
		const changed = structuredClone(snapshot); mutate(changed);
		assert.throws(() => assertBubbleHostAuthored({ snapshot: changed, clips: items }));
	}
});
test("synthetic PNG is deterministic and losslessly contains all authored rows", () => {
	const png = bubbleHostImage(), { width, height } = bubbleHostSettings;
	assert.deepEqual(png, bubbleHostImage()); assert.equal(png.readUInt32BE(16), width); assert.equal(png.readUInt32BE(20), height);
	const compressed = [];
	for (let offset = 8; offset < png.length;) {
		const length = png.readUInt32BE(offset);
		if (png.toString("ascii", offset + 4, offset + 8) === "IDAT") compressed.push(png.subarray(offset + 8, offset + 8 + length));
		offset += length + 12;
	}
	const rows = inflateSync(Buffer.concat(compressed)); assert.equal(rows.length, height * (width * 4 + 1));
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
		assert.equal(rows[y * (width * 4 + 1)], 0);
		const offset = y * (width * 4 + 1) + x * 4 + 1;
		assert.deepEqual([...rows.subarray(offset, offset + 4)], [x % 256, y % 256, (x ^ y) % 256, (x + y) % 256]);
	}
});
test("path guards reject shared worktrees roots and parent escapes before runtime loads", async () => {
	assert.equal(bubbleHostOwnedFiles.length, 8);
	assert.doesNotThrow(() => assertBubbleHostPrivatePath("C:/tmps/bubble-run/project"));
	for (const path of ["", "relative", "C:/tmps", "C:/tmps/../Users", "C:/tmps-other/run", "E:/rocut"])
		assert.throws(() => assertBubbleHostPrivatePath(path));
	await assert.rejects(assertBubbleHostSource({ snapshot: "E:/rocut", manifestSha256: "", wasmSha256: "" }));
});
test("actual Creator helper preserves all 21 optical keys static fallbacks and separate time origins",
	{ skip: !process.env.ROCUT_BUBBLE_CREATOR_MODULE }, async () => {
		const helper = await loadBubbleHostAuthor(process.env.ROCUT_BUBBLE_CREATOR_MODULE), before = structuredClone(image);
		const actual = { staticShot: helper.author(image, "static"), animatedShot: helper.author(image, "animated"),
			sixteenShot: helper.author(image, "sixteen") };
		assert.deepEqual(actual.animatedShot.animations, shots.animatedShot.animations);
		for (const shot of Object.values(actual)) {
			assert.equal(shot.effects[0].params.startTicks, 12000); assert.equal(shot.effects[0].params.point0Time, 0);
			for (const [key, value] of Object.entries(bubbleHostParams)) assert.equal(shot.effects[0].params[key], value);
			assert.deepEqual(shot.source.resources, [image]);
		}
		assert.equal(actual.sixteenShot.effects[0].params.point15Time, 120000);
		assert.equal(Object.hasOwn(actual.staticShot.effects[0].params, "point2Time"), false);
		assert.equal(bubbleHostInvalidCases(bubbleHostClips(actual)).length, 192);
		assert.deepEqual(image, before); assert.equal(helper.files.length, 2);
	});
