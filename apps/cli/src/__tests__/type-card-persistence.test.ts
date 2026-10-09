import { expect, test } from "bun:test";
import {
	projectId,
	type ProgrammaticResource,
} from "@opencut/editor-contracts";
import { createHash } from "node:crypto";
import {
	mkdir,
	mkdtemp,
	readFile,
	rename,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
	TYPE_CARD_CLIPS,
	TYPE_CARD_FONTS,
	editedTypeCardSources,
	initialTypeCardSources,
	typeCardEditing,
	typeCardUpdate,
	type TypeCardSources,
} from "./type-card-persistence-fixture";
import {
	invalidTypeCardCases,
	TYPE_CARD_OVERFLOW_MARKER,
} from "./type-card-persistence-invalid";
import { startHost } from "../host";
import { TargetRegistry } from "../target-registry";

test("typeCard modes, author edits and exact font bytes survive offline Host restarts; malformed edits reject atomically", async () => {
	const base = process.env.ROCUT_TEST_ARTIFACT_ROOT ?? tmpdir();
	if (!isAbsolute(base))
		throw Error("Use an absolute private artifact directory");
	const root = await mkdtemp(
		join(resolve(base), "rocut-type-card-persistence-"),
	);
	const author = join(root, "author"),
		movedAuthor = join(root, "unavailable-author");
	await mkdir(author);
	const originals = new Map<string, Buffer>();
	for (const font of TYPE_CARD_FONTS) {
		const bytes = await readFile(
			resolve(
				import.meta.dir,
				"../../../../apps/web/public/motion-text/fonts",
				font.file,
			),
		);
		originals.set(font.id, bytes);
		await writeFile(join(author, font.file), bytes, { flag: "wx" });
	}
	const options = {
		projectRoot: join(root, "project"),
		registry: new TargetRegistry(join(root, "registry")),
		htmlBrowserExecutable: "",
		htmlFrameConnectionFile: "",
	};
	let host: Awaited<ReturnType<typeof startHost>> | undefined;
	let restoreNeeded = false,
		initial: TypeCardSources | undefined,
		originalProjectName: string | undefined;
	let primaryError: unknown;
	const currentHost = () => {
		if (!host) throw Error("Fixture Host is not running");
		return host;
	};
	const post = (
		route: string,
		body: unknown,
		overflowLiteral?: "1e400" | "-1e400",
	) => {
		let encoded = JSON.stringify(body);
		if (overflowLiteral) {
			const marker = JSON.stringify(TYPE_CARD_OVERFLOW_MARKER);
			if (encoded.split(marker).length !== 2)
				throw Error("Expected exactly one nonfinite wire marker");
			// 1e400 is valid JSON syntax but decodes to Infinity; ordinary stringify would silently use null.
			encoded = encoded.replace(marker, overflowLiteral);
		}
		return fetch(new URL(`api/${route}`, currentHost().editorUrl), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: encoded,
		});
	};
	const json = async <T>(route: string, body: unknown): Promise<T> => {
		const response = await post(route, body);
		if (!response.ok)
			throw Error(
				`typeCard fixture ${route} failed: HTTP ${response.status}: ${(await response.text()).slice(0, 2000)}`,
			);
		return response.json() as Promise<T>;
	};
	const revision = async () =>
		Number(await currentHost().automation.revision());
	const current = async () => {
		const clips = await currentHost().automation.clips();
		expect(clips).toHaveLength(2);
		const sources = Object.fromEntries(
			clips.map((clip) => [clip.id, clip.editing!.programmatic!]),
		);
		expect(Object.keys(sources).sort()).toEqual([...TYPE_CARD_CLIPS].sort());
		return sources;
	};
	const apply = async (
		expectedRevision: number,
		operations: readonly unknown[],
	) => {
		const result = await json<{ accepted: boolean; revision: number }>(
			"apply",
			{ expectedRevision, operations },
		);
		expect(result.accepted).toBe(true);
		expect(Number(result.revision)).toBe(expectedRevision + 1);
		expect(await revision()).toBe(expectedRevision + 1);
	};
	const reopen = async () => {
		await host?.close();
		host = undefined;
		host = await startHost(options);
	};
	const updates = (sources: TypeCardSources) =>
		TYPE_CARD_CLIPS.map((clipId) => typeCardUpdate(clipId, sources[clipId]));
	const restore = async () => {
		if (!restoreNeeded || !initial) return;
		if (!host) await reopen();
		const operations: unknown[] = updates(initial);
		if (originalProjectName !== undefined)
			operations.unshift({
				kind: "update-project",
				projectId: currentHost().automation.projectId,
				patch: { name: originalProjectName },
			});
		await apply(await revision(), operations);
		await reopen();
		expect(await current()).toEqual(initial);
		expect((await currentHost().automation.project())?.name).toBe(
			originalProjectName,
		);
		restoreNeeded = false;
	};
	try {
		await reopen();
		originalProjectName = (await currentHost().automation.project())?.name;
		const resources: ProgrammaticResource[] = [];
		for (const font of TYPE_CARD_FONTS)
			resources.push(
				(
					await json<{ resource: ProgrammaticResource }>(
						"programmatic/resources/import",
						{
							id: font.id,
							filePath: join(author, font.file),
							kind: "font",
							mimeType: "font/ttf",
							font: {
								family: font.family,
								weight: font.weight,
								style: "normal",
							},
						},
					)
				).resource,
			);
		expect(await revision()).toBe(0);
		initial = initialTypeCardSources(resources);
		await apply(0, [
			{
				kind: "update-project",
				projectId: currentHost().automation.projectId,
				patch: { frameRate: { numerator: 60, denominator: 1 } },
			},
			{
				kind: "create-track",
				track: {
					id: "type-card-track",
					name: "TypeCard persistence",
					kind: "graphic",
					hidden: false,
				},
			},
			...TYPE_CARD_CLIPS.map((clipId, index) => ({
				kind: "create-clip",
				clip: {
					id: clipId,
					trackId: "type-card-track",
					startTime: index * 480000,
					duration: 480000,
					trimStart: 0,
					trimEnd: 0,
					editing: typeCardEditing(initial![clipId]),
				},
			})),
		]);
		restoreNeeded = true;
		expect(await current()).toEqual(initial);
		expect(dirname(resolve(author))).toBe(root);
		expect(dirname(resolve(movedAuthor))).toBe(root);
		await rename(author, movedAuthor);
		await expect(stat(author)).rejects.toMatchObject({ code: "ENOENT" });
		await reopen();
		expect(await revision()).toBe(1);
		expect(await current()).toEqual(initial);
		const checkStoredFonts = async () => {
			for (const resource of resources) {
				const expected = TYPE_CARD_FONTS.find(
					(font) => font.id === resource.id,
				)!;
				expect(resource.kind).toBe("font");
				expect(resource.font).toMatchObject({
					family: expected.family,
					weight: expected.weight,
					style: "normal",
				});
				const response = await post("programmatic/resources/load", resource);
				expect(response.status).toBe(200);
				const bytes = Buffer.from(await response.arrayBuffer());
				expect(Uint8Array.from(bytes)).toEqual(
					Uint8Array.from(originals.get(resource.id)!),
				);
				expect(createHash("sha256").update(bytes).digest("hex")).toBe(
					resource.sha256,
				);
			}
		};
		await checkStoredFonts();
		const modified = editedTypeCardSources(resources);
		await apply(1, updates(modified));
		await reopen();
		expect(await revision()).toBe(2);
		expect(await current()).toEqual(modified);
		await checkStoredFonts();
		const stableProject = await currentHost().automation.project();
		const validPrefix = {
			kind: "update-project" as const,
			projectId: projectId(currentHost().automation.projectId),
			patch: { name: "MUST NOT COMMIT" },
		};
		expect(
			(
				await currentHost().automation.engine.dryRun({
					operations: [validPrefix],
				})
			).accepted,
		).toBe(true);
		const invalid = invalidTypeCardCases(resources);
		for (const item of invalid) {
			const response = await post(
				"apply",
				{
					expectedRevision: 2,
					operations: [
						validPrefix,
						typeCardUpdate("type-card-quiet", item.source),
					],
				},
				item.overflowLiteral,
			);
			expect(response.status, item.name).toBe(409);
			expect(await response.json(), item.name).toMatchObject({
				accepted: false,
			});
			expect(await revision(), item.name).toBe(2);
			expect(await current(), item.name).toEqual(modified);
			expect(await currentHost().automation.project(), item.name).toEqual(
				stableProject,
			);
		}
		await reopen();
		expect(await revision()).toBe(2);
		expect(await current()).toEqual(modified);
		expect(await currentHost().automation.project()).toEqual(stableProject);
		await restore();
		expect(await revision()).toBe(3);
		await checkStoredFonts();
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
					fontNote:
						"Exact local SFNT bytes with explicit fixture weights; not an assertion of upstream font file identity",
					scope:
						"real Host imports, two-mode author editing, atomic Agent transactions and offline reopen; not browser metrics/pixels, export or UI undo/redo",
				},
				null,
				2,
			),
			{ encoding: "utf8", flag: "wx" },
		);
		console.log(
			JSON.stringify({
				typeCardPersistence: true,
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
						"typeCard failure and dedicated-project restoration failure",
					)
				: restoreError;
		} finally {
			await host?.close();
		}
		// Retain only this run's private author files, attachment bytes and evidence for inspection.
	}
}, 60000);
