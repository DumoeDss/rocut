import { expect, spyOn, test } from "bun:test";
import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FileProjectStore } from "../file-store";
import { startHost } from "../host";
import { TargetRegistry } from "../target-registry";
import { runCli } from "../main";
import { loadImageSequenceClosure } from "../programmatic/image-sequence-closure";
import { imageSequenceFixture } from "./image-sequence-fixture";

test("authenticated sequence-import API and CLI preserve revision; durable closure survives host restart", async () => {
	const fixture = await imageSequenceFixture();
	const registryRoot = join(fixture.directory, "registry");
	const options = {
		projectRoot: join(fixture.directory, "project"),
		registry: new TargetRegistry(registryRoot),
		htmlBrowserExecutable: "",
		htmlFrameConnectionFile: "",
		engineToolchainDirectory: "",
	};
	let host: Awaited<ReturnType<typeof startHost>> | undefined;
	try {
		host = await startHost(options);
		const api = (route: string) => new URL(`api/${route}`, host!.editorUrl);
		const before = await (await fetch(api("context"))).json();
		const body = JSON.stringify(fixture.input);
		expect(
			(
				await fetch(
					new URL(
						"/wrong/api/programmatic/resources/import-image-sequence",
						host.editorUrl,
					),
					{ method: "POST", body },
				)
			).status,
		).toBe(401);
		const response = await fetch(
			api("programmatic/resources/import-image-sequence"),
			{ method: "POST", body },
		);
		const imported = await response.json();
		if (response.status !== 200) throw Error(JSON.stringify(imported));
		expect(imported.resource.kind).toBe("imageSequence");
		expect(imported.dependencies).toBe(6);
		const specPath = join(fixture.directory, "spec.json");
		await writeFile(specPath, body, "utf8");
		let stdout = "";
		const capture = spyOn(process.stdout, "write").mockImplementation(
			(chunk) => {
				stdout += Buffer.from(chunk).toString("utf8");
				return true;
			},
		);
		try {
			await runCli([
				"programmatic",
				"sequence-import",
				specPath,
				"--project",
				options.projectRoot,
				"--targets-root",
				registryRoot,
			]);
		} finally {
			capture.mockRestore();
		}
		expect(JSON.parse(stdout)).toMatchObject({
			resource: imported.resource,
			reused: true,
			reusedDependencies: 6,
		});
		expect((await (await fetch(api("context"))).json()).revision).toBe(
			before.revision,
		);
		await host.close();
		host = undefined;
		await rename(
			fixture.rootDirectory,
			join(fixture.directory, "author-moved"),
		);
		host = await startHost(options);
		const store = new FileProjectStore({
			root: options.projectRoot,
			schemaVersion: 31,
		});
		const [project] = await store.list();
		expect(
			(
				await loadImageSequenceClosure({
					store,
					projectId: project.id,
					resource: imported.resource,
				})
			).manifest,
		).toEqual(fixture.manifest);
		expect((await (await fetch(api("context"))).json()).revision).toBe(
			before.revision,
		);
	} finally {
		await host?.close();
		await fixture.cleanup();
	}
});
