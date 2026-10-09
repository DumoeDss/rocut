import { expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import {
	clipId,
	projectId,
	type ProgrammaticSource,
} from "@opencut/editor-contracts";
import { convergeSource } from "../../../../script/fixtures/mv-converge-source";
import { invalidConvergeCases } from "./converge-persistence-invalid";
import { startHost } from "../host";
import { TargetRegistry } from "../target-registry";

const editing = (programmatic: unknown) => ({
	type: "graphic",
	definitionId: "programmatic",
	params: {},
	programmatic,
});
const update = (source: unknown) => ({
	kind: "update-clip",
	clipId: "converge-clip",
	patch: { editing: editing(source) },
});

test("converge author edits survive Host restart and invalid transactions remain atomic", async () => {
	const base = process.env.ROCUT_TEST_ARTIFACT_ROOT ?? tmpdir();
	if (!isAbsolute(base))
		throw Error("Use an absolute private artifact directory");
	const root = await mkdtemp(
		join(resolve(base), "rocut-converge-persistence-"),
	);
	const options = {
		projectRoot: join(root, "project"),
		registry: new TargetRegistry(join(root, "registry")),
		htmlBrowserExecutable: "",
		htmlFrameConnectionFile: "",
	};
	let host: Awaited<ReturnType<typeof startHost>> | undefined;
	let initial: ProgrammaticSource | undefined;
	let originalName: string | undefined;
	let restoreNeeded = false;
	let primaryError: unknown;
	const currentHost = () => {
		if (!host) throw Error("Dedicated fixture Host is not running");
		return host;
	};
	const reopen = async () => {
		await host?.close();
		host = undefined;
		host = await startHost(options);
	};
	const revision = async () =>
		Number(await currentHost().automation.revision());
	const readSource = async () => {
		const clips = await currentHost().automation.clips();
		expect(clips).toHaveLength(1);
		expect(clips[0].id).toBe(clipId("converge-clip"));
		return clips[0].editing?.programmatic;
	};
	const post = (
		operations: readonly unknown[],
		expectedRevision: number,
		overflow?: string,
	) => {
		let body = JSON.stringify({ expectedRevision, operations });
		if (overflow) {
			const marker = JSON.stringify("CONVERGE_NONFINITE_WIRE");
			if (body.split(marker).length !== 2)
				throw Error("Expected one wire marker");
			body = body.replace(marker, overflow);
		}
		return fetch(new URL("api/apply", currentHost().editorUrl), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body,
		});
	};
	const apply = async (operations: readonly unknown[]) => {
		const before = await revision();
		const response = await post(operations, before);
		if (!response.ok)
			throw Error(
				`Converge fixture apply: ${response.status} ${(await response.text()).slice(0, 2000)}`,
			);
		expect(await response.json()).toMatchObject({ accepted: true });
		expect(await revision()).toBe(before + 1);
	};
	const restore = async () => {
		if (!restoreNeeded || !initial) return;
		if (!host) await reopen();
		await apply([
			{
				kind: "update-project",
				projectId: currentHost().automation.projectId,
				patch: { name: originalName },
			},
			update(initial),
		]);
		await reopen();
		expect(await readSource()).toEqual(initial);
		expect((await currentHost().automation.project())?.name).toBe(originalName);
		restoreNeeded = false;
	};
	try {
		await reopen();
		originalName = (await currentHost().automation.project())?.name;
		initial = convergeSource();
		await apply([
			{
				kind: "create-track",
				track: {
					id: "converge-track",
					name: "Converge fixture",
					kind: "graphic",
					hidden: false,
				},
			},
			{
				kind: "create-clip",
				clip: {
					id: "converge-clip",
					trackId: "converge-track",
					startTime: 0,
					duration: 480000,
					trimStart: 0,
					trimEnd: 0,
					editing: editing(initial),
				},
			},
		]);
		restoreNeeded = true;
		await reopen();
		expect(await revision()).toBe(1);
		expect(await readSource()).toEqual(initial);
		const modified: ProgrammaticSource = {
			...initial,
			seed: 43,
			recipe: {
				...initial.recipe!,
				nodes: initial.recipe!.nodes.map((node) => ({
					...node,
					scene:
						node.scene.kind === "converge"
							? {
									...node.scene,
									role: "foreground",
									settings: { ...node.scene.settings, grain: 0.11 },
								}
							: node.scene,
				})),
				outputRoles: ["foreground"],
			},
		};
		await apply([update(modified)]);
		await reopen();
		expect(await revision()).toBe(2);
		expect(await readSource()).toEqual(modified);
		const stableProject = await currentHost().automation.project();
		const prefix = {
			kind: "update-project" as const,
			projectId: projectId(currentHost().automation.projectId),
			patch: { name: "MUST NOT COMMIT" },
		};
		expect(
			(await currentHost().automation.engine.dryRun({ operations: [prefix] }))
				.accepted,
		).toBe(true);
		const invalid = invalidConvergeCases(initial);
		for (const item of invalid) {
			const response = await post(
				[prefix, update(item.source)],
				2,
				item.overflow,
			);
			expect(response.status, item.name).toBe(409);
			expect(await response.json(), item.name).toMatchObject({
				accepted: false,
			});
			expect(await revision(), item.name).toBe(2);
			expect(await readSource(), item.name).toEqual(modified);
			expect(await currentHost().automation.project(), item.name).toEqual(
				stableProject,
			);
		}
		await reopen();
		expect(await revision()).toBe(2);
		expect(await readSource()).toEqual(modified);
		expect(await currentHost().automation.project()).toEqual(stableProject);
		await restore();
		expect(await revision()).toBe(3);
		await writeFile(
			join(root, "evidence.json"),
			JSON.stringify(
				{
					passed: true,
					rejected: invalid.map(({ name }) => name),
					revisions: [1, 2, 2, 3],
					scope:
						"real isolated Host, author edits, atomic Agent transactions and offline reopen; not installed UI, browser pixels or encoding",
				},
				null,
				2,
			),
			{ encoding: "utf8", flag: "wx" },
		);
		console.log(
			JSON.stringify({
				convergePersistence: true,
				artifacts: root,
				rejected: invalid.length,
			}),
		);
	} catch (error) {
		primaryError = error;
		throw error;
	} finally {
		try {
			await restore();
		} catch (error) {
			throw primaryError
				? new AggregateError(
						[primaryError, error],
						"Converge test and restoration failed",
					)
				: error;
		} finally {
			await host?.close();
		}
	}
}, 60000);
