import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, unlink, rmdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createScreencastCapture } from "../probe-preview-screencast.mjs";

const sharp = createRequire(
	new URL("../../apps/web/package.json", import.meta.url),
)("sharp");
const displayed = { x: 0, y: 0, width: 160, height: 90 };
const state = { start: 100, startEpoch: 100000, now: 190, trusted: true };
const page = { evaluate: async () => state };

class Cdp extends EventEmitter {
	calls = [];
	async send(command, params) {
		this.calls.push({ command, params });
	}
}

async function frame(timestamp = 100.025, overrides = {}) {
	const data = await sharp({
		create: {
			width: 160,
			height: 90,
			channels: 4,
			background: { r: 0, g: 0, b: 255, alpha: 1 },
		},
	})
		.png()
		.toBuffer();
	return {
		data: data.toString("base64"),
		sessionId: 7,
		metadata: { timestamp, pageScaleFactor: 1, offsetTop: 0, ...overrides },
	};
}

test("uses frame-swap epoch, preserving observer overhead separately", async () => {
	const cdp = new Cdp();
	const observer = await createScreencastCapture({ page, cdp, displayed });
	try {
		cdp.emit("Page.screencastFrame", await frame());
		const sample = await observer.capture();
		assert.equal(sample.milliseconds, 25);
		assert.equal(sample.observerReturnMs, 90);
		assert.equal(sample.blue, 160 * 90);
		assert.equal(sample.light, 0);
		assert.equal(sample.trusted, true);
		assert.equal(sample.hash.length, 8);
		assert(
			cdp.calls.some(
				(call) =>
					call.command === "Page.screencastFrameAck" &&
					call.params.sessionId === 7,
			),
		);
	} finally {
		await observer.close();
	}
	assert.equal(cdp.listenerCount("Page.screencastFrame"), 0);
	assert.equal(cdp.calls.at(-1).command, "Page.stopScreencast");
});

test("pre-input frames remain negative instead of being clamped into a pass", async () => {
	const cdp = new Cdp();
	const observer = await createScreencastCapture({ page, cdp, displayed });
	try {
		cdp.emit("Page.screencastFrame", await frame(99.975));
		assert.equal((await observer.capture()).milliseconds, -25);
	} finally {
		await observer.close();
	}
});

test("reference PNG contains the observed pixels without another browser capture", async () => {
	const dir = await mkdtemp(join(tmpdir(), "rocut-screencast-test-"));
	const path = join(dir, "reference.png");
	const cdp = new Cdp();
	const observer = await createScreencastCapture({ page, cdp, displayed });
	try {
		cdp.emit("Page.screencastFrame", await frame());
		const sample = await observer.capture();
		const callsBefore = cdp.calls.length;
		await assert.rejects(
			observer.saveReference({ path, hash: "not-the-frame" }),
			/Reference changed/,
		);
		await observer.saveReference({ path, hash: sample.hash });
		const { data, info } = await sharp(path)
			.ensureAlpha()
			.raw()
			.toBuffer({ resolveWithObject: true });
		assert.equal(info.width, 160);
		assert.equal(info.height, 90);
		for (let offset = 0; offset < data.length; offset += 4)
			assert.deepEqual(
				[...data.subarray(offset, offset + 4)],
				[0, 0, 255, 255],
			);
		assert.equal(cdp.calls.length, callsBefore);
	} finally {
		await observer.close();
		await unlink(path).catch((error) => {
			if (error.code !== "ENOENT") throw error;
		});
		await rmdir(dir);
	}
});

for (const [name, overrides] of [
	["missing timestamp", { timestamp: undefined }],
	["scaled page", { pageScaleFactor: 2 }],
	["unexpected offset", { offsetTop: 10 }],
]) {
	test(
		"rejects " + name + " instead of reporting a false picture time",
		async () => {
			const cdp = new Cdp();
			const observer = await createScreencastCapture({ page, cdp, displayed });
			try {
				cdp.emit("Page.screencastFrame", await frame(100.025, overrides));
				await assert.rejects(observer.capture());
			} finally {
				await observer.close();
			}
			assert.equal(cdp.listenerCount("Page.screencastFrame"), 0);
		},
	);
}

test("failed startup detaches its event listener", async () => {
	const cdp = new Cdp();
	cdp.send = async () => {
		throw new Error("capture unavailable");
	};
	await assert.rejects(
		createScreencastCapture({ page, cdp, displayed }),
		/capture unavailable/,
	);
	assert.equal(cdp.listenerCount("Page.screencastFrame"), 0);
});
