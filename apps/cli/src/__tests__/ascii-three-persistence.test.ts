import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import { startHost } from "../host";
import { TargetRegistry } from "../target-registry";
import { prepareAsciiThreeProbe } from "../../../../script/fixtures/prepare-ascii-three-probe";

const toolchain = process.env.ROCUT_TEST_THREE_TOOLCHAIN;
test.skipIf(!toolchain)(
	"ASCII Three source, native effect and archived rebuild survive Host restarts without author paths",
	async () => {
		const parent = resolve(tmpdir()),
			root = await mkdtemp(join(parent, "rocut-ascii-reopen-"));
		const { spec, imports } = await prepareAsciiThreeProbe(
			join(root, "author"),
		);
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
			const response = await post(route, body),
				value = await response.json();
			if (!response.ok) throw Error(JSON.stringify(value));
			return value;
		};
		const current = async () => (await host.automation.clips())[0].editing!;
		const revision = async () =>
			(await (await fetch(api("context"))).json()).revision;
		const editing = (source: ProgrammaticSource, cellSize: number) => ({
			type: "graphic",
			definitionId: "programmatic",
			params: {},
			programmatic: source,
			effects: [
				{
					id: "ascii",
					type: "ascii",
					enabled: true,
					params: { amount: 1, cellSize, contrast: 0.9, color: 0.4, seed: 19 },
				},
			],
		});
		const update = (source: ProgrammaticSource, cellSize: number) => [
			{
				kind: "update-clip",
				clipId: "model",
				patch: { editing: editing(source, cellSize) },
			},
		];
		try {
			const resources = [];
			for (const input of imports)
				resources.push(
					(await json("programmatic/resources/import", input)).resource,
				);
			const { source } = await json("programmatic/build/compile", {
				...spec,
				resources,
			});
			await json("apply", {
				expectedRevision: 0,
				operations: [
					{
						kind: "create-track",
						track: {
							id: "three",
							name: "Three",
							kind: "graphic",
							hidden: false,
						},
					},
					{
						kind: "create-clip",
						clip: {
							id: "model",
							trackId: "three",
							startTime: 0,
							duration: 120000,
							trimStart: 0,
							trimEnd: 0,
							editing: editing(source, 12),
						},
					},
				],
			});
			await rename(spec.sourceDirectory, join(root, "unavailable-author"));
			await host.close();
			host = await startHost(options);
			expect(await current()).toMatchObject(editing(source, 12));
			expect(await revision()).toBe(1);
			const rebuilt = (
				await json("programmatic/build/rebuild", (await current()).programmatic)
			).source;
			expect(rebuilt).toEqual(source); // Same archived inputs and toolchain must produce the same document digest.
			const modified = (
				await json("programmatic/build/rebuild", {
					...source,
					build: {
						...source.build,
						inputProps: { cameraX: -2.5, tint: "#28aaff" },
					},
				})
			).source;
			expect(modified.resources[0].sha256).not.toBe(source.resources[0].sha256);
			await json("apply", {
				expectedRevision: 1,
				operations: update(modified, 24),
			});
			await host.close();
			host = await startHost(options);
			expect(await current()).toMatchObject(editing(modified, 24));
			expect(await revision()).toBe(2);
			const rejected = await post("apply", {
				expectedRevision: 2,
				operations: update(modified, 65),
			});
			expect(rejected.status).toBe(409);
			expect(await revision()).toBe(2);
			expect(await current()).toMatchObject(editing(modified, 24));
			await json("apply", {
				expectedRevision: 2,
				operations: update(source, 12),
			});
			expect(await current()).toMatchObject(editing(source, 12));
			const artifactsParent = resolve(
				import.meta.dir,
				"../../../../.artifacts/ascii-three-persistence",
			);
			await mkdir(artifactsParent, { recursive: true });
			const artifacts = await mkdtemp(join(artifactsParent, "run-"));
			const evidence = {
				ok: true,
				resources,
				originalDocumentSha256: source.resources[0].sha256,
				modifiedDocumentSha256: modified.resources[0].sha256,
				archivedRebuildEqual: true,
				invalidUpdateStatus: rejected.status,
				restoredRevision: await revision(),
				scope:
					"real compile/rebuild + Agent persistence; no attached-editor undo/redo or GPU rendering in this test",
			};
			await writeFile(
				join(artifacts, "evidence.json"),
				JSON.stringify(evidence, null, 2) + "\n",
				{ encoding: "utf8", flag: "wx" },
			);
			console.log(JSON.stringify({ ...evidence, artifacts }));
		} finally {
			await host.close();
			if (
				dirname(root) !== parent ||
				!basename(root).startsWith("rocut-ascii-reopen-")
			)
				throw Error("Unsafe ASCII fixture cleanup");
			await rm(root, { recursive: true, force: true });
		}
	},
	90000,
);
