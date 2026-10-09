import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attachFlameExportVideoDownload } from "./mv-flame-export-video-download.mjs";

const bytes = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3]);
const metadata = {
	fileName: "flame.webm",
	byteLength: bytes.length,
	sha256: createHash("sha256").update(bytes).digest("hex"),
	mimeType: "video/webm",
	transport: "blob-download",
};
async function setup({ signal, clock } = {}) {
	const directory = await mkdtemp(join(tmpdir(), "rocut-flame-download-cpu-")),
		page = new EventEmitter();
	page.exposeFunction = async (_name, binding) => {
		page.binding = binding;
	};
	const transport = await attachFlameExportVideoDownload({
		page,
		directory,
		signal,
		clock,
	});
	const cleanup = async () => {
		transport.dispose();
		await rm(join(directory, "flame.webm"), { force: true });
		await rmdir(directory);
	};
	return { directory, page, transport, cleanup };
}
function download({ filename = "flame.webm", fail = false } = {}) {
	return {
		suggestedFilename: () => filename,
		saveAs: async (file) => {
			if (fail) throw Error("saveAs failed");
			await writeFile(file, bytes, { flag: "wx" });
		},
	};
}
test("Flame metadata ack waits for saveAs and independently verified binary hash", async () => {
	const fixture = await setup();
	try {
		fixture.page.emit("download", download());
		await fixture.page.binding(metadata);
		const saved = await fixture.transport.done;
		assert.deepEqual(saved.metadata, metadata);
		assert.equal(saved.file, join(fixture.directory, "flame.webm"));
		assert.equal(fixture.transport.state.downloadCount, 1);
		assert.equal(fixture.transport.state.completed, true);
	} finally {
		await fixture.cleanup();
	}
});
test("Flame failed saveAs and digest mismatch reject both ack and done", async () => {
	for (const fail of [true, false]) {
		const fixture = await setup();
		try {
			fixture.page.emit("download", download({ fail }));
			await assert.rejects(
				fixture.page.binding(
					fail ? metadata : { ...metadata, sha256: "f".repeat(64) },
				),
			);
			await assert.rejects(fixture.transport.done);
			assert.equal(fixture.transport.state.completed, false);
		} finally {
			await fixture.cleanup();
		}
	}
});
test("Flame unsolicited download is rejected and duplicate cannot masquerade as one artifact", async () => {
	for (const duplicate of [false, true]) {
		const fixture = await setup();
		try {
			if (duplicate)
				fixture.page.emit("download", {
					suggestedFilename: () => "flame.webm",
					saveAs: async () => {},
				});
			fixture.page.emit(
				"download",
				download({ filename: duplicate ? "flame.webm" : "other.webm" }),
			);
			await assert.rejects(fixture.transport.done, /unsolicited/);
			await assert.rejects(fixture.page.binding(metadata), /unsolicited/);
		} finally {
			await fixture.cleanup();
		}
	}
});
test("Flame cancellation/pageclose/dispose rejects pending paths and removes owned listeners", async () => {
	for (const action of ["abort", "close", "dispose"]) {
		const controller = new AbortController(),
			fixture = await setup({ signal: controller.signal });
		try {
			const ackRejected = assert.rejects(fixture.page.binding(metadata));
			if (action === "abort") controller.abort(Error("cancelled"));
			else if (action === "close") fixture.page.emit("close");
			else fixture.transport.dispose();
			await ackRejected;
			await assert.rejects(fixture.transport.done);
			fixture.transport.dispose();
			assert.equal(fixture.page.listenerCount("download"), 0);
			assert.equal(fixture.page.listenerCount("close"), 0);
		} finally {
			await fixture.cleanup();
		}
	}
});

test("Flame transport deadline starts on first event, never during long rendering prelude", async () => {
	let now = 0;
	const pending = new Map();
	const clock = {
		setTimeout: (callback, ms) => {
			const handle = {};
			pending.set(handle, { callback, at: now + ms });
			return handle;
		},
		clearTimeout: (handle) => {
			pending.delete(handle);
		},
	};
	const fixture = await setup({ clock });
	try {
		now = 4 * 60 * 1000;
		assert.equal(pending.size, 0);
		assert.equal(fixture.transport.state.error, null);
		const ack = assert.rejects(fixture.page.binding(metadata), /timed out/);
		assert.equal(pending.size, 1);
		now += 60000;
		for (const { callback, at } of [...pending.values()])
			if (at <= now) callback();
		await ack;
		await assert.rejects(fixture.transport.done, /timed out/);
		assert.equal(pending.size, 0);
	} finally {
		await fixture.cleanup();
	}
});

test("Flame saved truncated binary cannot pass metadata acknowledgement", async () => {
	const fixture = await setup();
	try {
		fixture.page.emit("download", {
			suggestedFilename: () => "flame.webm",
			saveAs: async (file) => {
				await writeFile(file, bytes.subarray(0, 3), { flag: "wx" });
			},
		});
		await assert.rejects(fixture.page.binding(metadata));
		await assert.rejects(fixture.transport.done);
		assert.equal(fixture.transport.state.completed, false);
	} finally {
		await fixture.cleanup();
	}
});
