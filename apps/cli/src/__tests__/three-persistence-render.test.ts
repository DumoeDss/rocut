import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import {
	clipId,
	trackId,
	mediaTime,
	revisionOf,
	type ProgrammaticSource,
} from "@opencut/editor-contracts";
import { startHost } from "../host";
import { TargetRegistry } from "../target-registry";
import { prepareThreeProbe } from "../../../../script/fixtures/prepare-three-probe";
import { threeModel } from "../../../../script/fixtures/three-assets";

const toolchain = process.env.ROCUT_TEST_THREE_TOOLCHAIN,
	browser = process.env.ROCUT_TEST_THREE_BROWSER;
test.skipIf(!toolchain || !browser)(
	"Three real PNG survives Host restart and same-ID model replacement without stale resource resurrection",
	async () => {
		const parent = resolve(tmpdir()),
			root = await mkdtemp(join(parent, "rocut-three-reopen-"));
		const { spec, imports } = await prepareThreeProbe(join(root, "author"));
		const options = {
			projectRoot: join(root, "project"),
			registry: new TargetRegistry(join(root, "registry")),
			engineToolchainDirectory: toolchain,
			htmlBrowserExecutable: browser,
			htmlFrameConnectionFile: "",
		};
		let host = await startHost(options);
		const post = (route: string, body: unknown) =>
			fetch(new URL(`api/${route}`, host.editorUrl), {
				method: "POST",
				body: JSON.stringify(body),
			});
		const json = async (route: string, body: unknown) => {
			const response = await post(route, body),
				value = await response.json();
			if (!response.ok) throw Error(JSON.stringify(value));
			return value;
		};
		const png = async (source: ProgrammaticSource) => {
			const response = await post("programmatic/frame", {
				source,
				clipStart: 0,
				clipDuration: 120000,
				trimStart: 0,
				timelineTime: 60000,
			});
			if (!response.ok) throw Error(await response.text());
			expect(response.headers.get("content-type")).toBe("image/png");
			return Buffer.from(await response.arrayBuffer());
		};
		const current = async () =>
			(await host.automation.clips()).find((c) => c.id === "scene")!.editing!
				.programmatic!;
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
			const before = await png(source);
			await host.automation.apply({
				expectedRevision: revisionOf(0),
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
							id: clipId("scene"),
							trackId: trackId("three"),
							startTime: mediaTime({ ticks: 0 }),
							duration: mediaTime({ ticks: 120000 }),
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
			await rename(spec.sourceDirectory, join(root, "removed-author"));
			await host.close();
			host = await startHost(options);
			expect(await current()).toEqual(source);
			const reopened = await png(await current());
			expect(reopened.equals(before)).toBe(true);
			const filePath = join(root, "replacement.glb");
			await writeFile(filePath, threeModel(0.5));
			const { resource } = await json("programmatic/resources/import", {
				id: "assets/model.glb",
				filePath,
				kind: "model",
				mimeType: "model/gltf-binary",
			});
			const replaced: ProgrammaticSource = {
				...source,
				resources: source.resources.map((r: { id: string }) =>
					r.id === resource.id ? resource : r,
				),
			};
			expect(replaced.resources![0]).toEqual(source.resources[0]); // Existing compiled driver remains valid.
			const replacement = await png(replaced);
			expect(replacement.equals(before)).toBe(false);
			await host.automation.apply({
				expectedRevision: revisionOf(1),
				operations: [
					{
						kind: "update-clip",
						clipId: clipId("scene"),
						patch: {
							editing: {
								type: "graphic",
								definitionId: "programmatic",
								params: {},
								programmatic: replaced,
							},
						},
					},
				],
			});
			await host.close();
			host = await startHost(options);
			expect(await current()).toEqual(replaced);
			expect((await png(await current())).equals(replacement)).toBe(true);
			await host.automation.apply({
				expectedRevision: revisionOf(2),
				operations: [
					{
						kind: "update-clip",
						clipId: clipId("scene"),
						patch: {
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
			expect((await png(await current())).equals(before)).toBe(true);
			const artifactsParent = resolve(
				import.meta.dir,
				"../../../../.artifacts/three-persistence",
			);
			await mkdir(artifactsParent, { recursive: true });
			const artifacts = await mkdtemp(join(artifactsParent, "run-")),
				hash = (value: Buffer) =>
					createHash("sha256").update(value).digest("hex");
			const evidence = {
				ok: true,
				backend: "private-chromium",
				before: hash(before),
				reopened: hash(reopened),
				replacement: hash(replacement),
				replacementRestored: true,
				originalModelSha256: resources[0].sha256,
				replacementModelSha256: resource.sha256,
				scope:
					"project persistence and explicit source restoration; not attached-UI undo/redo",
			};
			await writeFile(
				join(artifacts, "evidence.json"),
				JSON.stringify(evidence, null, 2) + "\n",
				"utf8",
			);
			console.log(JSON.stringify({ artifacts, ...evidence }));
		} finally {
			await host.close();
			if (
				dirname(root) !== parent ||
				!basename(root).startsWith("rocut-three-reopen-")
			)
				throw Error("Unsafe fixture cleanup");
			await rm(root, { recursive: true, force: true });
		}
	},
	90000,
);
