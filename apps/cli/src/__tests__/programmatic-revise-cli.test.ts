import { expect, spyOn, test } from "bun:test";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { runCli } from "../main";
import { TargetRegistry } from "../target-registry";

test("programmatic revise CLI sends strict UTF-8 spec to the authenticated revision route and propagates Host errors", async () => {
	const parent = resolve(tmpdir());
	const root = await mkdtemp(join(parent, "rocut-revise-cli-"));
	const targetId = "revision-transport-fixture";
	const token = "fixture-token";
	const calls: { url: string; method: string; body: unknown }[] = [];
	const source = {
		version: 1,
		runtime: "html-document",
		code: "<p>compiled output</p>",
		width: 64,
		height: 64,
		frameRate: { numerator: 30, denominator: 1 },
		durationFrames: 60,
		seed: 0,
	};
	const returned = { source, reusedDocument: true };
	let returnedValue: unknown = returned;
	let status = 200;
	const server = createServer(async (incoming, response) => {
		if (
			incoming.url === "/health" &&
			incoming.headers.authorization === `Bearer ${token}`
		) {
			response
				.writeHead(200, { "content-type": "application/json" })
				.end(JSON.stringify({ id: targetId }));
			return;
		}
		const chunks: Buffer[] = [];
		for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
		calls.push({
			url: incoming.url!,
			method: incoming.method!,
			body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
		});
		response
			.writeHead(status, { "content-type": "application/json" })
			.end(
				JSON.stringify(
					status === 200
						? returnedValue
						: { error: "archived source change refused" },
				),
			);
	});
	let restoreStdout: (() => void) | undefined;
	try {
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		const address = server.address();
		if (!address || typeof address === "string")
			throw Error("Missing fixture port");
		const registryRoot = join(root, "registry");
		await new TargetRegistry(registryRoot).register({
			entry: {
				id: targetId,
				port: address.port,
				pid: process.pid,
				projectPath: root,
				startedAt: Date.now(),
			},
			secret: { id: targetId, port: address.port, token },
		});
		const spec = {
			source,
			changes: [{ id: "index.html", code: "<p>\u4fee\u6539</p>" }],
			inputProps: { title: "\u65b0\u6807\u9898" },
		};
		const file = join(root, "revise.json");
		await writeFile(file, JSON.stringify(spec), "utf8");
		let stdout = "";
		const capture = spyOn(process.stdout, "write").mockImplementation(
			(chunk) => {
				stdout += Buffer.from(chunk).toString("utf8");
				return true;
			},
		);
		restoreStdout = () => capture.mockRestore();
		const run = (positional: string[]) =>
			runCli([
				"programmatic",
				...positional,
				"--targets-root",
				registryRoot,
				"--target",
				targetId,
			]);
		await run(["revise", file]);
		expect(JSON.parse(stdout)).toEqual(returned);
		expect(calls).toEqual([
			{
				url: `/${token}/api/programmatic/build/revise`,
				method: "POST",
				body: spec,
			},
		]);
		for (const positional of [["revise"], ["revise", file, "extra"]])
			await expect(run(positional)).rejects.toThrow(
				"usage: rocut programmatic",
			);
		expect(calls).toHaveLength(1);
		stdout = "";
		status = 422;
		await expect(run(["revise", file])).rejects.toThrow(
			"archived source change refused",
		);
		expect(stdout).toBe("");
		expect(calls).toHaveLength(2);
		status = 200;
		returnedValue = { source: { unknown: true }, reusedDocument: false };
		await expect(run(["revise", file])).rejects.toThrow(
			"Invalid programmatic build revision response",
		);
		expect(stdout).toBe("");
		expect(calls).toHaveLength(3);
		await writeFile(file, new Uint8Array([0xff]));
		await expect(run(["revise", file])).rejects.toThrow();
		expect(calls).toHaveLength(3);
	} finally {
		restoreStdout?.();
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		if (
			dirname(root) !== parent ||
			!basename(root).startsWith("rocut-revise-cli-")
		)
			throw Error("Unsafe revision CLI fixture cleanup");
		await rm(root, { recursive: true, force: true });
	}
});
