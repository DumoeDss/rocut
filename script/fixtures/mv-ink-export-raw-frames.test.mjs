import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
	inkExportRawFrames,
	closeInkExportReaders,
} from "./mv-ink-export-raw-frames.mjs";

function mockChild() {
	const child = new EventEmitter();
	child.stdout = new PassThrough();
	child.stderr = new PassThrough();
	child.exitCode = null;
	child.signalCode = null;
	child.kills = 0;
	child.kill = () => {
		child.kills++;
		child.signalCode = "SIGTERM";
		child.stdout.destroy();
		queueMicrotask(() => child.emit("close", null));
		return true;
	};
	child.finish = (code) => {
		child.exitCode = code;
		child.stdout.end();
		queueMicrotask(() => child.emit("close", code));
	};
	return child;
}
function readerFor(child, signal) {
	return inkExportRawFrames({
		ffmpeg: "mock-only",
		args: [],
		signal,
		frameBytes: 6,
		spawnProcess: () => child,
	});
}
test("Ink raw reader joins arbitrary chunks into exact independent frames", async () => {
	const child = mockChild(),
		reader = readerFor(child);
	child.stdout.write(Buffer.from([1, 2]));
	child.stdout.write(Buffer.from([3, 4, 5, 6, 7, 8, 9]));
	child.stdout.write(Buffer.from([10, 11, 12]));
	child.finish(0);
	assert.deepEqual(
		(await reader.next()).value,
		Buffer.from([1, 2, 3, 4, 5, 6]),
	);
	assert.deepEqual(
		(await reader.next()).value,
		Buffer.from([7, 8, 9, 10, 11, 12]),
	);
	assert.equal((await reader.next()).done, true);
	await reader.return();
	assert.equal(child.kills, 0);
});
test("Ink raw reader rejects partial frame and nonzero process exit", async () => {
	for (const [bytes, code, expected] of [
		[Buffer.from([1]), 0, /Incomplete/],
		[Buffer.alloc(0), 1, /exit 1/],
	]) {
		const child = mockChild(),
			reader = readerFor(child);
		child.stdout.write(bytes);
		child.finish(code);
		await assert.rejects(reader.next(), expected);
		await reader.return();
	}
});
test("Ink paired cleanup kills both owned children before waiting on pending reads", async () => {
	const children = [mockChild(), mockChild()],
		readers = children.map((child) => readerFor(child));
	const pending = readers.map((reader) =>
		reader.next().catch((error) => error),
	);
	await closeInkExportReaders(readers);
	await Promise.all(pending);
	assert.deepEqual(
		children.map((child) => child.kills),
		[1, 1],
	);
});
test("Ink AbortSignal interrupts pending decode and releases its owned process", async () => {
	const controller = new AbortController(),
		child = mockChild(),
		reader = readerFor(child, controller.signal);
	const pending = reader.next().catch((error) => error);
	controller.abort(Error("cancelled"));
	await reader.return();
	assert((await pending) instanceof Error);
	assert.equal(child.kills, 1);
});

test("Ink failed paired next immediately stops its still-pending sibling", async () => {
	const failed = mockChild(),
		hanging = mockChild();
	const readers = [readerFor(failed), readerFor(hanging)];
	const operation = Promise.all(readers.map((reader) => reader.next()));
	failed.finish(1);
	try {
		await assert.rejects(operation, /exit 1/);
	} finally {
		await closeInkExportReaders(readers);
	}
	assert.equal(failed.kills, 0);
	assert.equal(hanging.kills, 1);
});
