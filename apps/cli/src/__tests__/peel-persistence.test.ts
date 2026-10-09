import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import { startHost } from "../host";
import { TargetRegistry } from "../target-registry";
import { transitionSource } from "../../../../script/fixtures/mv-transition-fixture";
import {
	peelStyle,
	peelWithStyle,
} from "../../../../script/fixtures/peel-fixture";

test("Agent persists and restores original Peel parameters; invalid tessellation cannot alter a project", async () => {
	const parent = resolve(tmpdir()),
		root = await mkdtemp(join(parent, "rocut-peel-reopen-"));
	const options = {
		projectRoot: join(root, "project"),
		registry: new TargetRegistry(join(root, "registry")),
		htmlBrowserExecutable: "",
		htmlFrameConnectionFile: "",
	};
	let host = await startHost(options);
	const api = (route: string) => new URL(`api/${route}`, host.editorUrl);
	const post = (body: unknown) =>
		fetch(api("apply"), { method: "POST", body: JSON.stringify(body) });
	const apply = async (body: unknown) => {
		const response = await post(body);
		if (!response.ok) throw Error(await response.text());
		return response.json();
	};
	const current = async () =>
		(await host.automation.clips())[0].editing!.programmatic!;
	const revision = async () =>
		(await (await fetch(api("context"))).json()).revision;
	const editing = (source: ProgrammaticSource) => ({
		type: "graphic",
		definitionId: "programmatic",
		params: {},
		programmatic: source,
	});
	const update = (source: ProgrammaticSource) => [
		{
			kind: "update-clip",
			clipId: "peel",
			patch: { editing: editing(source) },
		},
	];
	try {
		const source = transitionSource(peelStyle());
		await apply({
			expectedRevision: 0,
			operations: [
				{
					kind: "create-track",
					track: {
						id: "visuals",
						name: "Visuals",
						kind: "graphic",
						hidden: false,
					},
				},
				{
					kind: "create-clip",
					clip: {
						id: "peel",
						trackId: "visuals",
						startTime: 0,
						duration: 120000,
						trimStart: 0,
						trimEnd: 0,
						editing: editing(source),
					},
				},
			],
		});
		await host.close();
		host = await startHost(options);
		expect(await revision()).toBe(1);
		expect(await current()).toEqual(source);
		const modified = peelWithStyle(source, {
			...peelStyle("down"),
			curl: 0.3,
			perspective: 0.2,
			shading: 0.3,
			segments: 48,
		});
		await apply({ expectedRevision: 1, operations: update(modified) });
		await host.close();
		host = await startHost(options);
		expect(await revision()).toBe(2);
		expect(await current()).toEqual(modified);
		const response = await post({
			expectedRevision: 2,
			operations: update(
				peelWithStyle(source, { ...peelStyle(), segments: 1000000 }),
			),
		});
		expect(response.status).toBe(409);
		expect(await revision()).toBe(2);
		expect(await current()).toEqual(modified);
		await apply({ expectedRevision: 2, operations: update(source) });
		expect(await revision()).toBe(3);
		expect(await current()).toEqual(source);
		const artifactsParent = resolve(
			import.meta.dir,
			"../../../../.artifacts/peel-persistence",
		);
		await mkdir(artifactsParent, { recursive: true });
		const artifacts = await mkdtemp(join(artifactsParent, "run-"));
		const evidence = {
			ok: true,
			reopened: true,
			modifiedReopened: true,
			invalidUpdateStatus: response.status,
			restoredRevision: 3,
			scope:
				"headless Agent persistence and explicit restoration; not attached-editor undo/redo",
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
			!basename(root).startsWith("rocut-peel-reopen-")
		)
			throw Error("Unsafe Peel fixture cleanup");
		await rm(root, { recursive: true, force: true });
	}
}, 30000);
