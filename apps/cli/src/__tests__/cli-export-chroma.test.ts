import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	EXPORT_PROTOCOL,
	LEGACY_EXPORT_PROTOCOL,
} from "../host-export-protocol";
import { runCli } from "../main";
import { TargetRegistry } from "../target-registry";

interface ExportRequest {
	method: string;
	body?: unknown;
}

/** Real CLI resolution and HTTP transport, with no attached encoder or output. */
async function withExportHost(
	status: unknown,
	run: (fixture: {
		invoke: (flags: string[]) => Promise<void>;
		requests: ExportRequest[];
	}) => Promise<void>,
) {
	const root = await mkdtemp(path.join(tmpdir(), "rocut-cli-chroma-"));
	const id = "chroma-cli-fixture";
	const token = "test-fixture-only";
	const requests: ExportRequest[] = [];
	const server = createServer(async (request, response) => {
		response.setHeader("content-type", "application/json");
		if (request.url === "/health") {
			response.end(JSON.stringify({ id }));
			return;
		}
		if (request.url !== `/${token}/api/export`) {
			response.writeHead(404);
			response.end(JSON.stringify({ error: "unexpected fixture route" }));
			return;
		}
		if (request.method === "GET") {
			requests.push({ method: "GET" });
			response.end(JSON.stringify(status));
			return;
		}
		const chunks: Buffer[] = [];
		for await (const chunk of request) chunks.push(Buffer.from(chunk));
		requests.push({
			method: request.method ?? "unknown",
			body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
		});
		// Stop before polling; this fixture intentionally has no renderer.
		response.writeHead(409);
		response.end(JSON.stringify({ error: "fixture has no encoder" }));
	});
	try {
		const port = await new Promise<number>((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", () => {
				server.off("error", reject);
				resolve((server.address() as { port: number }).port);
			});
		});
		await new TargetRegistry(root).register({
			entry: {
				id,
				port,
				pid: process.pid,
				projectPath: root,
				startedAt: Date.now(),
			},
			secret: { id, port, token },
		});
		await run({
			requests,
			invoke: (flags) =>
				runCli(["export", "--targets-root", root, "--target", id, ...flags]),
		});
	} finally {
		await new Promise<void>((resolve) => {
			server.close(() => resolve());
			server.closeAllConnections();
		});
		await rm(root, { recursive: true, force: true });
	}
}

describe("CLI WebM chroma transport", () => {
	test("explicit q0 preflights v3 and reaches the POST unchanged", async () => {
		await withExportHost({ protocol: EXPORT_PROTOCOL }, async (fixture) => {
			await expect(
				fixture.invoke([
					"--format",
					"webm",
					"--video-quantizer",
					"0",
					"--quality",
					"low",
				]),
			).rejects.toThrow("fixture has no encoder");
			expect(fixture.requests).toEqual([
				{ method: "GET" },
				{
					method: "POST",
					body: { format: "webm", videoQuantizer: 0, quality: "low" },
				},
			]);
		});
	});
	test("v2 Host declaration refuses explicit q before any POST", async () => {
		await withExportHost(
			{ protocol: LEGACY_EXPORT_PROTOCOL },
			async (fixture) => {
				await expect(
					fixture.invoke(["--format", "webm", "--video-quantizer", "32"]),
				).rejects.toThrow("does not declare explicit VP9 quantizer");
				expect(fixture.requests).toEqual([{ method: "GET" }]);
			},
		);
	});
	test("4:4:4 preflights the real Host request before forwarding unchanged options", async () => {
		await withExportHost({ protocol: EXPORT_PROTOCOL }, async (fixture) => {
			await expect(
				fixture.invoke([
					"--format",
					"webm",
					"--video-chroma",
					"444",
					"--quality",
					"medium",
					"--no-audio",
					"--start-time",
					"100",
					"--end-time",
					"200",
				]),
			).rejects.toThrow("fixture has no encoder");
			expect(fixture.requests).toEqual([
				{ method: "GET" },
				{
					method: "POST",
					body: {
						format: "webm",
						videoChroma: "444",
						quality: "medium",
						includeAudio: false,
						range: { startTime: 100, endTime: 200 },
					},
				},
			]);
		});
	});

	test("legacy or malformed Host protocol prevents the actual POST", async () => {
		for (const status of [
			{ surfaces: 1, jobs: [] },
			{ protocol: { version: 2, videoChroma: "444" } },
			{ protocol: { version: 1, videoChroma: ["444"] } },
		]) {
			await withExportHost(status, async (fixture) => {
				await expect(
					fixture.invoke(["--format", "webm", "--video-chroma", "444"]),
				).rejects.toThrow("does not declare WebM 4:4:4");
				expect(fixture.requests).toEqual([{ method: "GET" }]);
			});
		}
	});

	test("omitted and explicit 4:2:0 preserve the legacy no-preflight path", async () => {
		for (const videoChroma of [undefined, "420"]) {
			await withExportHost({}, async (fixture) => {
				await expect(
					fixture.invoke(
						videoChroma === undefined ? [] : ["--video-chroma", videoChroma],
					),
				).rejects.toThrow("fixture has no encoder");
				expect(fixture.requests).toEqual([
					{
						method: "POST",
						body: {
							format: "mp4",
							quality: "high",
							...(videoChroma === undefined ? {} : { videoChroma }),
						},
					},
				]);
			});
		}
	});

	test("invalid chroma flags fail before any export transport", async () => {
		await withExportHost({ protocol: EXPORT_PROTOCOL }, async (fixture) => {
			for (const flags of [
				["--video-chroma"],
				["--video-chroma", "422"],
				["--format", "mp4", "--video-chroma", "444"],
			]) {
				await expect(fixture.invoke(flags)).rejects.toThrow("--video-chroma");
			}
			expect(fixture.requests).toEqual([]);
		});
	});
});
