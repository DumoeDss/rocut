import { expect, test } from "bun:test";
import {
	projectId,
	type ProgrammaticResource,
} from "@opencut/editor-contracts";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rename, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { writeEmberAssets } from "./ember-persistence-assets";
import {
	EMBER_CLIPS,
	editedEmberSources,
	initialEmberSources,
	emberEditing,
	emberUpdate,
	type EmberSources,
} from "./ember-persistence-fixture";
import { emberHost } from "./ember-persistence-host";
import { invalidEmberCases } from "./ember-persistence-invalid";

test("Ember three modes, edited cues/HUD/manual keys and exact attachments survive offline Host restarts; malformed transactions reject atomically", async () => {
	const base = process.env.ROCUT_TEST_ARTIFACT_ROOT ?? tmpdir();
	if (!isAbsolute(base))
		throw Error("Use an absolute private artifact directory");
	const root = await mkdtemp(join(resolve(base), "rocut-ember-persistence-"));
	const author = join(root, "author"),
		movedAuthor = join(root, "unavailable-author");
	await mkdir(author);
	const assets = await writeEmberAssets(author);
	const h = emberHost(root);
	let restoreNeeded = false,
		initial: EmberSources | undefined,
		originalProjectName: string | undefined,
		primaryError: unknown;
	const restore = async () => {
		if (!restoreNeeded || !initial) return;
		await h.reopen();
		const operations: unknown[] = h.updates(initial);
		if (originalProjectName !== undefined)
			operations.unshift({
				kind: "update-project",
				projectId: h.currentHost().automation.projectId,
				patch: { name: originalProjectName },
			});
		await h.apply(await h.revision(), operations);
		await h.reopen();
		expect(await h.current()).toEqual(initial);
		expect((await h.currentHost().automation.project())?.name).toBe(
			originalProjectName,
		);
		restoreNeeded = false;
	};
	try {
		await h.reopen();
		originalProjectName = (await h.currentHost().automation.project())?.name;
		const resources: ProgrammaticResource[] = [];
		for (const { bytes: _bytes, ...asset } of assets)
			resources.push(
				(
					await h.json<{ resource: ProgrammaticResource }>(
						"programmatic/resources/import",
						{ ...asset, filePath: join(author, asset.id) },
					)
				).resource,
			);
		expect(await h.revision()).toBe(0);
		initial = initialEmberSources(resources);
		await h.apply(0, [
			{
				kind: "update-project",
				projectId: h.currentHost().automation.projectId,
				patch: { frameRate: { numerator: 30, denominator: 1 } },
			},
			{
				kind: "create-track",
				track: {
					id: "ember-track",
					name: "Ember persistence",
					kind: "graphic",
					hidden: false,
				},
			},
			...EMBER_CLIPS.map((clipId, index) => ({
				kind: "create-clip",
				clip: {
					id: clipId,
					trackId: "ember-track",
					startTime: index * 120000,
					duration: 120000,
					trimStart: 0,
					trimEnd: 0,
					editing: emberEditing(initial![clipId]),
				},
			})),
		]);
		restoreNeeded = true;
		expect(await h.current()).toEqual(initial);
		expect(dirname(resolve(author))).toBe(root);
		expect(dirname(resolve(movedAuthor))).toBe(root);
		await rename(author, movedAuthor);
		await expect(stat(author)).rejects.toMatchObject({ code: "ENOENT" });
		await h.reopen();
		expect(await h.revision()).toBe(1);
		expect(await h.current()).toEqual(initial);
		const checkStoredBytes = async () => {
			for (const resource of resources) {
				const expected = assets.find((asset) => asset.id === resource.id)!;
				expect(resource.kind).toBe(expected.kind);
				if (expected.kind === "font")
					expect(resource.font).toMatchObject(expected.font);
				const response = await h.post("programmatic/resources/load", resource);
				expect(response.status).toBe(200);
				const bytes = new Uint8Array(await response.arrayBuffer());
				expect(bytes).toEqual(Uint8Array.from(expected.bytes));
				expect(createHash("sha256").update(bytes).digest("hex")).toBe(
					resource.sha256,
				);
			}
		};
		await checkStoredBytes();
		const modified = editedEmberSources(resources);
		await h.apply(1, h.updates(modified));
		await h.reopen();
		expect(await h.revision()).toBe(2);
		expect(await h.current()).toEqual(modified);
		await checkStoredBytes();
		const stableProject = await h.currentHost().automation.project();
		const validPrefix = {
			kind: "update-project" as const,
			projectId: projectId(h.currentHost().automation.projectId),
			patch: { name: "MUST NOT COMMIT" },
		};
		expect(
			(
				await h
					.currentHost()
					.automation.engine.dryRun({ operations: [validPrefix] })
			).accepted,
		).toBe(true);
		const invalid = invalidEmberCases(resources);
		for (const item of invalid) {
			const response = await h.post(
				"apply",
				{
					expectedRevision: 2,
					operations: [validPrefix, emberUpdate("ember-breathe", item.source)],
				},
				item.overflowLiteral,
			);
			expect(response.status, item.name).toBe(409);
			expect(await response.json(), item.name).toMatchObject({
				accepted: false,
			});
			expect(await h.revision(), item.name).toBe(2);
			expect(await h.current(), item.name).toEqual(modified);
			expect(await h.currentHost().automation.project(), item.name).toEqual(
				stableProject,
			);
		}
		await h.reopen();
		expect(await h.revision()).toBe(2);
		expect(await h.current()).toEqual(modified);
		expect(await h.currentHost().automation.project()).toEqual(stableProject);
		await restore();
		expect(await h.revision()).toBe(3);
		await checkStoredBytes();
		await writeFile(
			join(root, "evidence.json"),
			JSON.stringify(
				{
					passed: true,
					resources,
					rejectedCases: invalid.map(({ name }) => name),
					revisions: {
						originalReopen: 1,
						editedReopen: 2,
						rejectedReopen: 2,
						restoredReopen: 3,
					},
					scope:
						"Real Host local imports, three-mode authored edits including mode swaps, exact attachment bytes, atomic Agent transactions and offline reopen; not browser metrics/pixels, export or UI undo/redo",
					analysisNote:
						"Reviewed synthetic fixture samples through actual prepareMvAudioJson; not native analyzer acceptance",
				},
				null,
				2,
			),
			{ encoding: "utf8", flag: "wx" },
		);
		console.log(
			JSON.stringify({
				emberPersistence: true,
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
		} catch (restoreError) {
			throw primaryError
				? new AggregateError(
						[primaryError, restoreError],
						"Ember failure and dedicated-project restoration failure",
					)
				: restoreError;
		} finally {
			await h.close();
		}
		// Dedicated test data/evidence is retained. No user project was opened.
	}
}, 60000);
