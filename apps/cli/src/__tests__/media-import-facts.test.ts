import { afterEach, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AutomationApi } from "@opencut/editor-automation";
import type { ProjectId, ProjectStore } from "@opencut/editor-ports";

if (process.env.OPENCUT_FACTS_CLI_TEST_ISOLATED !== "1") {
	test("media facts import runs with an isolated probe double", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			env: { ...process.env, OPENCUT_FACTS_CLI_TEST_ISOLATED: "1" },
			stdout: "pipe",
			stderr: "pipe",
		});
		if (result.exitCode !== 0)
			throw new Error(result.stdout.toString() + result.stderr.toString());
	});
} else {
	let available = true;
	let wrongDigest = false;
	let probes = 0;
	const digest = (value: Uint8Array | string) =>
		createHash("sha256").update(value).digest("hex");
	mock.module("@opencut/editor-classic/media-import", () => ({
		supportsMediaFacts: () => available,
		probeMediaImport: async () => {
			throw new Error("Image fixture must not demux");
		},
		probeSourceMediaFacts: async ({ bytes }: { bytes: Uint8Array }) => {
			probes++;
			return {
				schemaVersion: 1,
				source: "byte-probe",
				sha256: wrongDigest ? "0".repeat(64) : digest(bytes),
				alpha: false,
			};
		},
	}));
	const { importLocalMedia, inspectLocalMediaImport } =
		await import("../media-import");
	const roots: string[] = [];
	afterEach(async () => {
		available = true;
		wrongDigest = false;
		probes = 0;
		for (const root of roots.splice(0))
			await rm(root, { recursive: true, force: true });
	});
	async function fixture(version?: unknown) {
		const root = await mkdtemp(path.join(tmpdir(), "rocut-media-facts-"));
		roots.push(root);
		const bytes = new Uint8Array([1, 2, 3]);
		const filePath = path.join(root, "image.png");
		await writeFile(filePath, bytes);
		const input = {
			filePath,
			expectedRevision: 4,
			idempotencyKey: "import",
			image: { mimeType: "image/png", width: 32, height: 18 },
			...(version !== undefined ? { mediaFactsVersion: version } : {}),
		};
		let batch: any;
		let attachment: any = null;
		let applies = 0;
		const result = { revision: 5 };
		const transport = {
			input,
			projectId: "project" as ProjectId,
			store: {
				loadAttachment: async () => attachment,
				saveAttachment: async (value: unknown) => {
					attachment = value;
				},
			} as unknown as ProjectStore,
			automation: {
				engine: {
					dryRun: async (candidate: unknown) => ({
						accepted: true,
						replayed:
							batch !== undefined &&
							JSON.stringify(candidate) === JSON.stringify(batch),
						result,
					}),
				},
				apply: async (value: unknown) => {
					applies++;
					batch = value;
					return result;
				},
				assets: async () => batch?.operations.map((op: any) => op.asset) ?? [],
			} as unknown as AutomationApi,
		};
		return { transport, bytes, state: () => ({ batch, attachment, applies }) };
	}
	test("versionless imports retain exact historical identity, metadata and transaction JSON", async () => {
		const f = await fixture();
		const sha = digest(f.bytes);
		const probed = {
			type: "image",
			mimeType: "image/png",
			width: 32,
			height: 18,
		};
		const id = `media-${digest(JSON.stringify(["import", sha, "image.png", probed]))}`;
		await importLocalMedia(f.transport);
		expect(probes).toBe(0);
		expect(f.state().attachment.metadata).toEqual({
			id,
			name: "image.png",
			...probed,
			lastModified: 0,
		});
		expect(f.state().batch).toEqual({
			expectedRevision: 4,
			idempotencyKey: "import",
			operations: [
				{
					kind: "create-asset",
					asset: {
						id,
						name: "image.png",
						kind: "image",
						width: 32,
						height: 18,
					},
				},
			],
		});
	});
	test("selected v1 binds independent source digest and native facts to asset and attachment replay", async () => {
		const f = await fixture(1);
		const imported = await importLocalMedia(f.transport);
		expect(imported.asset.sourceSha256).toBe(digest(f.bytes));
		expect(imported.asset.mediaFacts?.sha256).toBe(digest(f.bytes));
		expect(imported.asset.mediaFacts?.alpha).toBe(false);
		expect(f.state().attachment.metadata.mediaFacts).toEqual(
			imported.asset.mediaFacts,
		);
		expect((await inspectLocalMediaImport(f.transport)).status).toBe(
			"committed",
		);
		expect(f.state().applies).toBe(1);
	});
	test("missing runtime cannot silently run a selected spec as legacy", async () => {
		available = false;
		const f = await fixture(1);
		await expect(importLocalMedia(f.transport)).rejects.toThrow(
			"runtime-unavailable",
		);
		expect(f.state().applies).toBe(0);
	});
	test("wrong native digest and invalid requested versions never persist or commit", async () => {
		wrongDigest = true;
		const f = await fixture(1);
		await expect(importLocalMedia(f.transport)).rejects.toThrow(
			"source-unverified",
		);
		expect(f.state().attachment).toBeNull();
		for (const version of [0, 2, "1", null]) {
			const bad = await fixture(version);
			await expect(importLocalMedia(bad.transport)).rejects.toThrow(
				"invalid-media-facts-version",
			);
			expect(bad.state().applies).toBe(0);
		}
	});
}
