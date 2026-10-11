import { expect, test } from "bun:test";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { runAgentCli } from "../agent-cli";
import type { ResolvedTarget } from "../target-registry";

test("object-params CLI sends the spec to authenticated read-only route and prints Rust envelope", async () => {
	const parent = resolve(tmpdir());
	const root = await mkdtemp(join(parent, "rocut-object-params-cli-"));
	const input = { object: "liquid", params: { version: 1 } };
	const output = { version: 1, ok: false, error: { code: "params", message: "Rust rejection" } };
	let received: { route?: string; body?: unknown } = {};
	const server = createServer((request, response) => {
		void (async () => {
			const chunks: Buffer[] = [];
			for await (const chunk of request) chunks.push(Buffer.from(chunk));
			received = { route: request.url, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
			response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(output));
		})().catch(() => response.writeHead(500).end());
	});
	await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
	const file = join(root, "request.json");
	const originalWrite = process.stdout.write;
	let printed = "";
	try {
		await writeFile(file, JSON.stringify(input), { encoding: "utf8", flag: "wx" });
		process.stdout.write = ((chunk: unknown) => { printed += String(chunk); return true; }) as typeof process.stdout.write;
		const resolved = { secret: { port: (server.address() as AddressInfo).port, token: "fixture-only" } } as ResolvedTarget;
		await runAgentCli({ command: "programmatic", positional: ["object-params", file], resolved });
		expect(received).toEqual({ route: "/fixture-only/api/programmatic/object-params", body: input });
		expect(JSON.parse(printed)).toEqual(output);
		await writeFile(file, new Uint8Array([0xff]));
		await expect(runAgentCli({ command: "programmatic", positional: ["object-params", file], resolved })).rejects.toThrow();
		await expect(runAgentCli({ command: "programmatic", positional: ["object-params", file, "extra"], resolved })).rejects.toThrow("usage");
	} finally {
		process.stdout.write = originalWrite;
		server.closeAllConnections();
		await new Promise<void>(done => server.close(() => done()));
		if (dirname(resolve(root)) !== parent || !root.startsWith(join(parent, "rocut-object-params-cli-"))) throw Error("Unsafe CLI test cleanup");
		await rm(root, { recursive: true, force: true });
	}
});
