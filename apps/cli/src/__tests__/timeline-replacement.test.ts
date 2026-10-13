import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";

import {
	commitTimelineReplacement,
	readReplacementMedia,
	readReplacementRequest,
	timelineReplacementProbe,
} from "../timeline-replacement";

async function fixture(run: (root: string) => Promise<void>) {
	const root = await mkdtemp(join(tmpdir(), "rocut-replacement-fixture-"));
	try {
		await mkdir(join(root, "attachments", "asset"), { recursive: true });
		await writeFile(
			join(root, "attachments", "asset", "metadata.json"),
			JSON.stringify({ id: "asset", type: "video" }),
		);
		await writeFile(
			join(root, "attachments", "asset", "body.bin"),
			Buffer.from("actual-bytes"),
		);
		await run(root);
	} finally {
		if (
			dirname(resolve(root)) !== resolve(tmpdir()) ||
			!basename(root).startsWith("rocut-replacement-fixture-")
		)
			throw Error("Unsafe fixture cleanup");
		await rm(root, { recursive: true, force: true });
	}
}
test.skipIf(timelineReplacementProbe().guardedCommit)(
	"old actual WASM does not advertise guarded commit or supply a fallback",
	async () => {
		expect(timelineReplacementProbe()).toEqual({
			schemaVersion: 1,
			protocol: 1,
			guardedCommit: false,
		});
		await expect(
			commitTimelineReplacement({
				request: {},
				projectDirectory: "fixture",
				automation: {} as never,
			}),
		).rejects.toThrow("kernel-unavailable");
	},
);
test("bounded media reads actual disk bytes rather than supplied descriptors", () =>
	fixture(async (root) => {
		const result = await readReplacementMedia(root, "asset");
		expect(result.bytes.toString()).toBe("actual-bytes");
		expect(result.metadata).toEqual({ id: "asset", type: "video" });
		await writeFile(join(root, "attachments", "asset", "body.bin"), "changed");
		expect((await readReplacementMedia(root, "asset")).bytes.toString()).toBe(
			"changed",
		);
	}));
test("media traversal and redirected body rejected", () =>
	fixture(async (root) => {
		await expect(readReplacementMedia(root, "../asset")).rejects.toThrow(
			"media-id",
		);
		await rm(join(root, "attachments", "asset", "body.bin"));
		await writeFile(join(root, "outside.bin"), "outside");
		await symlink(
			join(root, "outside.bin"),
			join(root, "attachments", "asset", "body.bin"),
		);
		await expect(readReplacementMedia(root, "asset")).rejects.toThrow(
			"redirected",
		);
	}));
test("metadata and requests require strict UTF8", () =>
	fixture(async (root) => {
		await writeFile(
			join(root, "attachments", "asset", "metadata.json"),
			Buffer.from([255]),
		);
		await expect(readReplacementMedia(root, "asset")).rejects.toThrow();
		await expect(
			readReplacementRequest(
				Readable.from([Buffer.from([255])]) as IncomingMessage,
			),
		).rejects.toThrow();
	}));
test("streamed request limit checked before JSON allocation", async () => {
	await expect(
		readReplacementRequest(
			Readable.from([
				Buffer.alloc(4 * 1024 * 1024),
				Buffer.from("x"),
			]) as IncomingMessage,
		),
	).rejects.toThrow("request-limit");
	expect(
		await readReplacementRequest(
			Readable.from(['{"schemaVersion":1}']) as IncomingMessage,
		),
	).toEqual({ schemaVersion: 1 });
});
