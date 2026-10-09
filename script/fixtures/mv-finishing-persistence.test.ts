import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import { startHost } from "../../apps/cli/src/host";
import { TargetRegistry } from "../../apps/cli/src/target-registry";
import {
	animatedFinishingSource,
	exportFinishingSource,
} from "./mv-finishing-source";

test("all five finishing effects and amount curves survive real Host/FileProjectStore close/reopen; invalid edits are atomic", async () => {
	const parent = resolve(tmpdir()),
		root = await mkdtemp(join(parent, "rocut-mv-finishing-store-"));
	const options = {
		projectRoot: join(root, "project"),
		registry: new TargetRegistry(join(root, "registry")),
		htmlBrowserExecutable: "",
		htmlFrameConnectionFile: "",
	};
	let host = await startHost(options);
	const editing = (source: ProgrammaticSource) => ({
		type: "graphic",
		definitionId: "programmatic",
		params: {},
		programmatic: source,
	});
	const post = (body: unknown) =>
		fetch(new URL("api/apply", host.editorUrl), {
			method: "POST",
			body: JSON.stringify(body),
		});
	const current = async () =>
		(await host.automation.clips()).map((clip) => clip.editing!.programmatic!);
	const revision = async () =>
		(await (await fetch(new URL("api/context", host.editorUrl))).json())
			.revision;
	const sources = [exportFinishingSource(), animatedFinishingSource()];
	try {
		const response = await post({
			expectedRevision: 0,
			operations: [
				{
					kind: "create-track",
					track: {
						id: "finish",
						name: "Finishing",
						kind: "graphic",
						hidden: false,
					},
				},
				...sources.map((source, index) => ({
					kind: "create-clip",
					clip: {
						id: `finish-${index}`,
						trackId: "finish",
						startTime: index * 60000,
						duration: 60000,
						trimStart: 0,
						trimEnd: 0,
						editing: editing(source),
					},
				})),
			],
		});
		if (!response.ok) throw Error(JSON.stringify(await response.json()));
		expect(await current()).toEqual(sources);
		await host.close();
		host = await startHost(options);
		expect(await revision()).toBe(1);
		expect(await current()).toEqual(sources);
		const changed = sources.map((source) => ({
			...source,
			seed: 36,
			recipe: {
				...source.recipe!,
				post: source.recipe!.post!.map((group) => ({
					...group,
					stage: "role" as const,
					roles: ["foreground" as const],
				})),
			},
		}));
		const operations = (items: ProgrammaticSource[]) =>
			items.map((source, index) => ({
				kind: "update-clip",
				clipId: `finish-${index}`,
				patch: { editing: editing(source) },
			}));
		const update = await post({
			expectedRevision: 1,
			operations: operations(changed),
		});
		if (!update.ok) throw Error(JSON.stringify(await update.json()));
		await host.close();
		host = await startHost(options);
		expect(await revision()).toBe(2);
		expect(await current()).toEqual(changed);
		const invalid = {
			...changed[1],
			recipe: {
				...changed[1].recipe!,
				post: [
					{
						stage: "composite" as const,
						effects: [{ kind: "fade" as const, amount: 1.01 }],
					},
				],
			},
		};
		const rejected = await post({
			expectedRevision: 2,
			operations: operations([sources[0], invalid]),
		});
		expect(rejected.status).toBe(409);
		expect(await revision()).toBe(2);
		expect(await current()).toEqual(changed);
		await host.close();
		host = await startHost(options);
		expect(await revision()).toBe(2);
		expect(await current()).toEqual(changed);
	} finally {
		await host.close();
		if (
			dirname(root) !== parent ||
			!basename(root).startsWith("rocut-mv-finishing-store-")
		)
			throw Error("Unsafe finishing persistence cleanup");
		await rm(root, { recursive: true, force: true });
	}
}, 30000);
