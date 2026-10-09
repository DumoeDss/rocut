import { expect, spyOn, test } from "bun:test";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import type { ProgrammaticResource } from "@opencut/editor-contracts";
import { startHost } from "../host";
import { TargetRegistry } from "../target-registry";
import { runCli } from "../main";
import { imageSequenceFixture } from "./image-sequence-fixture";

interface Restored {
	directory: string;
	sourceDirectory: string;
	entryFile: string;
	originalManifestPath: string;
	receiptPath: string;
}

test("authenticated HTTP and CLI restore authoring files after source relocation without revision changes", async () => {
	const fixture = await imageSequenceFixture();
	const outputParent = join(fixture.directory, "restores");
	await mkdir(outputParent);
	await writeFile(join(outputParent, "keep.txt"), "unrelated-file", "utf8");
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
		const importedResponse = await fetch(
			api("programmatic/resources/import-image-sequence"),
			{
				method: "POST",
				body: JSON.stringify(fixture.input),
			},
		);
		expect(importedResponse.status).toBe(200);
		const { resource }: { resource: ProgrammaticResource } =
			await importedResponse.json();
		await host.close();
		host = undefined;
		await rename(
			fixture.rootDirectory,
			join(fixture.directory, "author-moved"),
		);
		host = await startHost(options);
		const input = { resource, outputParent },
			body = JSON.stringify(input);
		const denied = await fetch(
			new URL(
				"/wrong/api/programmatic/resources/restore-image-sequence-source",
				host.editorUrl,
			),
			{ method: "POST", body },
		);
		expect(denied.status).toBe(401);
		await denied.arrayBuffer();
		expect(await readdir(outputParent)).toEqual(["keep.txt"]);
		const response = await fetch(
			api("programmatic/resources/restore-image-sequence-source"),
			{ method: "POST", body },
		);
		const restored: Restored = await response.json();
		if (response.status !== 200) throw Error(JSON.stringify(restored));
		const checkRestored = async (result: Restored) => {
			expect(isAbsolute(result.directory)).toBe(true);
			expect(relative(outputParent, result.directory)).not.toContain("..");
			expect(result.entryFile).toBe("project.blend");
			expect([
				...(await readFile(join(result.sourceDirectory, result.entryFile))),
			]).toEqual([1, 2, 3, 4, 5]);
			expect(await readFile(result.originalManifestPath, "utf8")).toBe(
				'{"render":"original-author-manifest"}',
			);
			expect(JSON.stringify(result)).not.toContain('"body"');
		};
		await checkRestored(restored);
		const spec = join(fixture.directory, "restore-spec.json");
		await writeFile(spec, body, "utf8");
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
				"sequence-restore",
				spec,
				"--project",
				options.projectRoot,
				"--targets-root",
				registryRoot,
			]);
		} finally {
			capture.mockRestore();
		}
		const fromCli: Restored = JSON.parse(stdout);
		await checkRestored(fromCli);
		expect(fromCli.directory).not.toBe(restored.directory);
		expect(await readFile(join(outputParent, "keep.txt"), "utf8")).toBe(
			"unrelated-file",
		);
		expect((await (await fetch(api("context"))).json()).revision).toBe(
			before.revision,
		);
	} finally {
		await host?.close();
		await fixture.cleanup();
	}
});
