import { expect, test } from "bun:test";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import {
	clipId,
	trackId,
	mediaTime,
	revisionOf,
} from "@opencut/editor-contracts";
import { startHost } from "../host";
import { TargetRegistry } from "../target-registry";
import { prepareThreeProbe } from "../../../../script/fixtures/prepare-three-probe";

const toolchain = process.env.ROCUT_TEST_THREE_TOOLCHAIN;
test.skipIf(!toolchain)(
	"Three compiles one pinned offline runtime, persists attachments and rebuilds without author directory",
	async () => {
		const parent = resolve(tmpdir()),
			root = await mkdtemp(join(parent, "rocut-three-build-test-"));
		const { spec, imports } = await prepareThreeProbe(join(root, "author"));
		const options = {
			projectRoot: join(root, "project"),
			registry: new TargetRegistry(join(root, "registry")),
			engineToolchainDirectory: toolchain,
			htmlBrowserExecutable: "",
			htmlFrameConnectionFile: "",
		};
		let host = await startHost(options);
		const api = (route: string) => new URL(`api/${route}`, host.editorUrl);
		const post = (route: string, body: unknown) =>
			fetch(api(route), { method: "POST", body: JSON.stringify(body) });
		const json = async (route: string, body: unknown) => {
			const response = await post(route, body);
			const value = await response.json();
			if (!response.ok) throw Error(JSON.stringify(value));
			return value;
		};
		try {
			const resources = [];
			for (const item of imports)
				resources.push(
					(await json("programmatic/resources/import", item)).resource,
				);
			const { source } = await json("programmatic/build/compile", {
				...spec,
				resources,
			});
			expect(source.build).toMatchObject({
				engine: "three",
				engineVersion: "0.185.1",
			});
			expect(source.resources.slice(1)).toEqual(resources);
			const response = await post(
					"programmatic/resources/load",
					source.resources[0],
				),
				html = await response.text();
			expect(response.status).toBe(200);
			expect(html).toContain("rocut-runtime-notices");
			expect(html).toContain("@elftia/three-assets");
			expect(html).not.toContain(spec.sourceDirectory);
			expect(html).not.toContain(toolchain!);
			const lock = await json(
				"programmatic/resources/load",
				source.build.toolchainLock,
			);
			expect(lock.adapter).toMatchObject({
				id: "rocut-three-html",
				version: 1,
			});
			expect(lock.adapter.sha256).toMatch(/^[a-f0-9]{64}$/);
			const invalid = {
				...spec,
				resources: [
					{
						...resources[0],
						sha256: "f".repeat(64),
						attachmentKey: "programmatic-sha256-" + "f".repeat(64),
					},
				],
			};
			expect((await post("programmatic/build/compile", invalid)).status).toBe(
				422,
			);
			await writeFile(
				join(spec.sourceDirectory, "escape.ts"),
				"import 'node:fs'; export function createScene(){}",
				"utf8",
			);
			expect(
				(
					await post("programmatic/build/compile", {
						...spec,
						entryFile: "escape.ts",
						files: ["escape.ts"],
					})
				).status,
			).toBe(422);
			expect(
				(
					await post("programmatic/build/compile", {
						...spec,
						inputProps: null,
					})
				).status,
			).toBe(422);
			const context = await (await fetch(api("context"))).json();
			await host.automation.apply({
				expectedRevision: revisionOf(context.revision),
				operations: [
					{
						kind: "create-track",
						track: {
							id: trackId("three"),
							name: "Three",
							kind: "graphic",
							hidden: false,
						},
					},
					{
						kind: "create-clip",
						clip: {
							id: clipId("model"),
							trackId: trackId("three"),
							startTime: mediaTime({ ticks: 0 }),
							duration: mediaTime({ ticks: 240000 }),
							trimStart: mediaTime({ ticks: 0 }),
							trimEnd: mediaTime({ ticks: 0 }),
							editing: {
								type: "graphic",
								definitionId: "programmatic",
								params: {},
								programmatic: source,
							},
						},
					},
				],
			});
			await rename(spec.sourceDirectory, join(root, "author-removed"));
			await host.close();
			host = await startHost(options);
			expect(
				(await host.automation.clips()).find((c) => c.id === "model")?.editing
					?.programmatic,
			).toEqual(source);
			expect(await json("programmatic/build/rebuild", source)).toEqual({
				source,
				reusedDocument: true,
			});
			const changed = await json("programmatic/build/rebuild", {
				...source,
				build: { ...source.build, inputProps: { scale: 0.5 } },
			});
			expect(changed.source.resources.slice(1)).toEqual(resources);
			expect(changed.source.resources[0].sha256).not.toBe(
				source.resources[0].sha256,
			);
			expect(
				(
					await post("programmatic/build/rebuild", {
						...source,
						build: { ...source.build, engineVersion: "0.170.0" },
					})
				).status,
			).toBe(422);
		} finally {
			await host.close();
			if (
				dirname(root) !== parent ||
				!basename(root).startsWith("rocut-three-build-test-")
			)
				throw Error("Unsafe fixture cleanup");
			await rm(root, { recursive: true, force: true });
		}
	},
	60000,
);
