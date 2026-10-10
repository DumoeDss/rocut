import assert from "node:assert/strict";
import test from "node:test";
import { flameWrapMediaCommand } from "./flame-wrap-editor-export-decode.mjs";

test("raw decoder stdout preserves all byte values, including invalid UTF-8 and NUL", async () => {
	const expected = Buffer.from(
		Array.from({ length: 768 }, (_, index) => index % 256),
	);
	const result = await flameWrapMediaCommand({
		command: process.execPath,
		args: [
			"-e",
			"process.stdout.write(Buffer.from(Array.from({length:768},(_,i)=>i%256)))",
		],
	});
	assert(Buffer.isBuffer(result));
	assert.deepEqual(result, expected);
	assert.notEqual(
		Buffer.from(expected.toString("utf8")).length,
		expected.length,
	);
});

test("ffprobe-style JSON is explicitly UTF-8, and binary never uses implicit default", async () => {
	const result = await flameWrapMediaCommand({
		command: process.execPath,
		args: [
			"-e",
			"process.stdout.write(JSON.stringify({frames:13,codec:'vp9'}))",
		],
		encoding: "utf8",
	});
	assert.deepEqual(JSON.parse(result), { frames: 13, codec: "vp9" });
	await assert.rejects(
		flameWrapMediaCommand({
			command: process.execPath,
			args: [],
			encoding: "latin1",
		}),
		/Explicit/,
	);
});

test("decoder failure keeps the original nonzero exit code", async () => {
	await assert.rejects(
		flameWrapMediaCommand({
			command: process.execPath,
			args: ["-e", "process.exit(7)"],
		}),
		{ code: 7 },
	);
});
