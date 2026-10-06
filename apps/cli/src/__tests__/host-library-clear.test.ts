import { expect, test } from "bun:test";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startHost } from "../host";
import { TargetRegistry } from "../target-registry";
import { HttpProjectStore } from "../../../vite-example/src/host/http-project-store";

test("HTTP namespace clear removes only Saved records, preserving project, attachments and other libraries", async () => {
	const parent = await realpath(tmpdir());
	const root = await mkdtemp(path.join(parent, "rocut-library-clear-"));
	const host = await startHost({
		projectRoot: path.join(root, "project"),
		registry: new TargetRegistry(path.join(root, "targets")),
	});
	try {
		const base = `http://127.0.0.1:${host.port}/${host.token}/api`;
		const store = new HttpProjectStore({ base });
		const projectId = (await store.list())[0].id;
		await store.saveAttachment({
			projectId,
			key: "audio",
			metadata: { name: "owned tone" },
			body: new Uint8Array([1, 2, 3]).buffer,
		});
		for (const [namespace, key] of [
			["saved-sounds", "first"],
			["saved-sounds", "second"],
			["custom-presets", "keep"],
		]) {
			await store.saveLibraryRecord({
				namespace,
				key,
				schemaVersion: 1,
				data: { owned: true },
			});
		}
		const before = await readFile(path.join(root, "project/project.json"));
		const denied = await fetch(
			`http://127.0.0.1:${host.port}/wrong/api/library/saved-sounds`,
			{ method: "DELETE" },
		);
		expect(denied.status).toBe(401);
		expect(
			await store.listLibraryRecords({ namespace: "saved-sounds" }),
		).toHaveLength(2);
		await store.clear({
			scope: { kind: "library", namespace: "saved-sounds" },
		});
		expect(
			await store.listLibraryRecords({ namespace: "saved-sounds" }),
		).toEqual([]);
		expect(
			await store.listLibraryRecords({ namespace: "custom-presets" }),
		).toHaveLength(1);
		expect(await readFile(path.join(root, "project/project.json"))).toEqual(
			before,
		);
		expect(
			await store.loadAttachment({ projectId, key: "audio" }),
		).toMatchObject({ body: new Uint8Array([1, 2, 3]).buffer });
		await store.clear({
			scope: { kind: "library", namespace: "saved-sounds" },
		});
		await expect(store.clear({ scope: { kind: "all" } })).rejects.toMatchObject(
			{ code: "unavailable" },
		);
		await expect(
			store.clear({ scope: { kind: "project", projectId } }),
		).rejects.toMatchObject({ code: "unavailable" });
	} finally {
		await host.close();
		expect(await realpath(root)).toBe(root);
		expect(path.dirname(root)).toBe(parent);
		await rm(root, { recursive: true, force: true });
	}
});

test("unsupported host or false success cannot silently clear the local library state", async () => {
	for (const status of [404, 500, 200]) {
		const calls: RequestInit[] = [];
		const store = new HttpProjectStore({
			fetchImpl: Object.assign(
				async (_url: RequestInfo | URL, init?: RequestInit) => {
					calls.push(init ?? {});
					return Response.json({ accepted: false }, { status });
				},
				{ preconnect: () => {} },
			),
		});
		await expect(
			store.clear({ scope: { kind: "library", namespace: "saved-sounds" } }),
		).rejects.toMatchObject({ code: "unavailable" });
		expect(calls).toHaveLength(1);
		expect(calls[0].method).toBe("DELETE");
	}
});
