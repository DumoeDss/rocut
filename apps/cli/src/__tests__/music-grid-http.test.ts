import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startHost } from "../host";
import { TargetRegistry } from "../target-registry";

test("existing authenticated host exposes music grid and queries never advance revision", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "rocut-music-http-"));
	const host = await startHost({
		projectRoot: path.join(root, "project"),
		registry: new TargetRegistry(path.join(root, "targets")),
	});
	try {
		const base = `http://127.0.0.1:${host.port}`;
		expect(
			(await fetch(`${base}/wrong/api/music-grid/capabilities`)).status,
		).toBe(401);
		const api = `${base}/${host.token}/api`;
		const before = (await (await fetch(`${api}/context`)).json()) as {
			revision: number;
		};
		const capability = (await (
			await fetch(`${api}/music-grid/capabilities`)
		).json()) as { status: string };
		expect(["available", "unavailable"]).toContain(capability.status);
		const query = await fetch(`${api}/music-grid/query`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ kind: "list", bindingId: "missing" }),
		});
		expect(query.status).toBe(200);
		const result = (await query.json()) as { status: string };
		expect(result.status).not.toBe("ready");
		const after = (await (await fetch(`${api}/context`)).json()) as {
			revision: number;
		};
		expect(after.revision).toEqual(before.revision);
	} finally {
		await host.close();
		const resolved = path.resolve(root);
		if (
			!resolved.startsWith(path.resolve(tmpdir()) + path.sep) ||
			!path.basename(resolved).startsWith("rocut-music-http-")
		)
			throw Error("Invalid temporary cleanup scope");
		await rm(resolved, { recursive: true, force: true });
	}
});
