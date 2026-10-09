import { expect, spyOn, test } from "bun:test";
import { createServer } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgentCli } from "../agent-cli";

test("inspection CLI transports UTF-8 specs and revision-only selections on authenticated routes", async () => {
	const root = await mkdtemp(join(tmpdir(), "rocut-inspection-cli-"));
	const calls: { url: string; body: unknown }[] = [];
	const server = createServer(async (request, response) => {
		const chunks: Buffer[] = [];
		for await (const chunk of request) chunks.push(Buffer.from(chunk));
		calls.push({
			url: request.url!,
			body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
		});
		response
			.writeHead(200, { "content-type": "application/json" })
			.end(JSON.stringify({ revision: "fixture" }));
	});
	const capture = spyOn(process.stdout, "write").mockImplementation(() => true);
	try {
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		const address = server.address();
		if (!address || typeof address === "string")
			throw Error("Missing fixture port");
		const resolved = {
			secret: { id: "fixture", port: address.port, token: "fixture-token" },
			entry: {
				id: "fixture",
				port: address.port,
				pid: process.pid,
				projectPath: root,
				startedAt: 1,
			},
		};
		const file = join(root, "input.json");
		const spec = {
			version: 1,
			sourceDirectory: "C:/作者项目",
			entryFile: "index.tsx",
			files: ["index.tsx"],
			seed: 7,
			inputProps: { title: "中文" },
		};
		await writeFile(file, JSON.stringify(spec), "utf8");
		await runAgentCli({
			command: "programmatic",
			positional: ["inspect", file],
			resolved,
		});
		const selection = {
			revision: "fixture",
			compositionId: "Example",
			frameRate: { numerator: 30, denominator: 1 },
		};
		await writeFile(file, JSON.stringify(selection), "utf8");
		await runAgentCli({
			command: "programmatic",
			positional: ["compile-inspected", file],
			resolved,
		});
		expect(calls).toEqual([
			{ url: "/fixture-token/api/programmatic/build/inspect", body: spec },
			{
				url: "/fixture-token/api/programmatic/build/compile-inspected",
				body: selection,
			},
		]);
		await writeFile(file, new Uint8Array([0xff]));
		await expect(
			runAgentCli({
				command: "programmatic",
				positional: ["inspect", file],
				resolved,
			}),
		).rejects.toThrow();
		expect(calls).toHaveLength(2);
	} finally {
		capture.mockRestore();
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		await rm(root, { recursive: true, force: true });
	}
});
