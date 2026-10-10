import { expect, test } from "bun:test";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { runAgentCli } from "../agent-cli";
import type { ResolvedTarget } from "../target-registry";

test("produced CLI sends a closed UTF-8 spec to the authenticated Host output route", async () => {
	const parent = resolve(tmpdir());
	const root = await mkdtemp(join(parent, "rocut-produced-cli-"));
	const input = { source: { label: "字幕 😀" }, firstFrame: 0, frameCount: 2, sampleRate: 48000 };
	const output = { version: 1, output: { directory: "exports/programmatic/remotion-test", artifacts: [] } };
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
		await runAgentCli({ command: "programmatic", positional: ["produced", file], resolved: {
			secret: { port: (server.address() as AddressInfo).port, token: "fixture-only" },
		} as ResolvedTarget });
		expect(received).toEqual({ route: "/fixture-only/api/programmatic/produced", body: input });
		expect(JSON.parse(printed)).toEqual(output);
	} finally {
		process.stdout.write = originalWrite;
		await new Promise<void>((done, fail) => server.close(error => error ? fail(error) : done()));
		if (dirname(resolve(root)) !== parent) throw Error("Unsafe produced CLI test cleanup");
		await rm(root, { recursive: true, force: true });
	}
});
