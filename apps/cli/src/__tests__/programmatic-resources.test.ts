import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileProjectStore } from "../file-store";
import { importProgrammaticResource } from "../programmatic/resource-import";
import { loadProgrammaticResource } from "../programmatic/resources";
import { startHost } from "../host";
import { TargetRegistry } from "../target-registry";
import { runCli } from "../main";

test("resource import is content addressed, portable on reopen, repeatable and fails closed on tampering", async () => {
	const parent = path.resolve(tmpdir());
	const root = await mkdtemp(path.join(parent, "rocut-resource-test-"));
	try {
		const filePath = path.join(root, "image.png");
		const bytes = Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM6kAAAAASUVORK5CYII=",
			"base64",
		);
		await writeFile(filePath, bytes);
		const options = { root: path.join(root, "project"), schemaVersion: 1 };
		const context = {
			store: new FileProjectStore(options),
			projectId: "fixture",
		};
		const input = {
			id: "image.png",
			kind: "image",
			mimeType: "image/png",
			filePath,
		};
		const first = await importProgrammaticResource({ ...context, input });
		expect(first.reused).toBe(false);
		expect(
			(await importProgrammaticResource({ ...context, input })).reused,
		).toBe(true);
		const loaded = await loadProgrammaticResource({
			...context,
			store: new FileProjectStore(options),
			resource: first.resource,
		});
		expect(Buffer.from(loaded.body)).toEqual(bytes);
		const archived = await importProgrammaticResource({ ...context, input: { ...input, kind: "source", mimeType: "application/octet-stream" } });
		expect(archived.resource.attachmentKey).not.toBe(first.resource.attachmentKey);
		expect(Buffer.from((await loadProgrammaticResource({ ...context, resource: archived.resource })).body)).toEqual(bytes);
		await writeFile(filePath, Buffer.concat([bytes, Buffer.from([1])]));
		const replaced = await importProgrammaticResource({ ...context, input });
		expect(replaced.resource.attachmentKey).not.toBe(
			first.resource.attachmentKey,
		);
		expect(
			Buffer.from(
				(
					await loadProgrammaticResource({
						...context,
						resource: first.resource,
					})
				).body,
			),
		).toEqual(bytes);
		for (const patch of [
			{ id: "../private" },
			{ mimeType: "text/javascript" },
			{ filePath: "relative.png" },
			{ extra: 1 },
		])
			await expect(
				importProgrammaticResource({
					...context,
					input: { ...input, ...patch },
				}),
			).rejects.toThrow();
		const attachment = (await context.store.loadAttachment({
			projectId: context.projectId,
			key: first.resource.attachmentKey,
		}))!;
		const broken = Buffer.from(bytes);
		broken[0] = 0;
		await context.store.saveAttachment({
			...attachment,
			body: broken.buffer.slice(
				broken.byteOffset,
				broken.byteOffset + broken.byteLength,
			) as ArrayBuffer,
		});
		await expect(
			loadProgrammaticResource({ ...context, resource: first.resource }),
		).rejects.toThrow("integrity mismatch");
		await writeFile(filePath, bytes);
		await expect(
			importProgrammaticResource({ ...context, input }),
		).rejects.toThrow("integrity mismatch");
		const signal = AbortSignal.abort();
		await expect(
			loadProgrammaticResource({
				...context,
				resource: replaced.resource,
				signal,
			}),
		).rejects.toThrow();
	} finally {
		if (
			path.dirname(root) !== parent ||
			!path.basename(root).startsWith("rocut-resource-test-")
		)
			throw Error("Unsafe fixture cleanup");
		await rm(root, { recursive: true, force: true });
	}
});

test("authenticated Agent resource API prepares attachments without changing revision, loads on host restart", async () => {
	const parent = path.resolve(tmpdir());
	const root = await mkdtemp(path.join(parent, "rocut-resource-route-"));
	const options = {
		projectRoot: path.join(root, "project"),
		registry: new TargetRegistry(path.join(root, "registry")),
		htmlBrowserExecutable: "",
		htmlFrameConnectionFile: "",
	};
	let host = await startHost(options);
	const api = (route: string) => new URL(`api/${route}`, host.editorUrl);
	try {
		const filePath = path.join(root, "font.ttf");
		await writeFile(filePath, Buffer.from([0, 1, 0, 0])); // storage test; real font decode is covered by browser probe
		const before = await (await fetch(api("context"))).json();
		expect(before.programmaticResources.kinds).toEqual(["image", "font", "video", "model", "environment", "analysis", "document", "source", "imageSequence"]);
		const body = JSON.stringify({
			filePath,
			id: "fonts/fixture.ttf",
			kind: "font",
			mimeType: "font/ttf",
			font: { family: "Fixture", weight: 400, style: "normal" },
		});
		expect(
			(
				await fetch(
					new URL("/wrong/api/programmatic/resources/import", host.editorUrl),
					{ method: "POST", body },
				)
			).status,
		).toBe(401);
		const imported = await fetch(api("programmatic/resources/import"), {
			method: "POST",
			body,
		});
		expect(imported.status).toBe(200);
		const { resource } = await imported.json();
		const specPath = path.join(root, "resource-spec.json");
		await writeFile(specPath, body, "utf8");
		const originalWrite = process.stdout.write;
		let stdout = "";
		process.stdout.write = ((chunk: string | Uint8Array) => {
			stdout += Buffer.from(chunk).toString("utf8");
			return true;
		}) as typeof process.stdout.write;
		try {
			await runCli([
				"resource",
				"import",
				specPath,
				"--project",
				options.projectRoot,
				"--targets-root",
				path.join(root, "registry"),
			]);
		} finally {
			process.stdout.write = originalWrite;
		}
		expect(JSON.parse(stdout)).toEqual({ resource, reused: true });
		expect((await (await fetch(api("context"))).json()).revision).toBe(
			before.revision,
		);
		await host.close();
		host = await startHost(options);
		const loaded = await fetch(api("programmatic/resources/load"), {
			method: "POST",
			body: JSON.stringify(resource),
		});
		expect(loaded.status).toBe(200);
		expect(loaded.headers.get("content-type")).toBe("font/ttf");
		expect([...new Uint8Array(await loaded.arrayBuffer())]).toEqual([
			0, 1, 0, 0,
		]);
		expect(
			(
				await fetch(api("programmatic/resources/load"), {
					method: "POST",
					body: JSON.stringify({ ...resource, attachmentKey: "../private" }),
				})
			).status,
		).not.toBe(200);
	} finally {
		await host.close();
		if (
			path.dirname(root) !== parent ||
			!path.basename(root).startsWith("rocut-resource-route-")
		)
			throw Error("Unsafe fixture cleanup");
		await rm(root, { recursive: true, force: true });
	}
});
