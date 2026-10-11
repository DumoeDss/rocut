import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pinInkHostToolchain } from "../../../../script/fixtures/ink-object-host-toolchain.mjs";
import { loadProgrammaticResource } from "../programmatic/resources";
import {
	originalThreeEntry,
	revisedThreeEntry,
	revisedThreeHelper,
	threeRevisionDigest,
	threeRevisionFixture,
	threeRevisionRoot,
} from "./programmatic-three-build-revision-fixture";

const toolchain = process.env.ROCUT_TEST_THREE_BUILD_REVISION_TOOLCHAIN;
test.skipIf(!toolchain)(
	"Three real archive revise compiles without author files and survives Host persistence",
	async () => {
		const head = spawnSync("git", ["rev-parse", "HEAD"], {
			cwd: threeRevisionRoot,
			encoding: "utf8",
			windowsHide: true,
		}).stdout.trim();
		const wasmRoot = realpathSync(
			join(threeRevisionRoot, "node_modules/opencut-wasm"),
		);
		const wasmSha256 = threeRevisionDigest(
			await readFile(join(wasmRoot, "opencut_wasm_bg.wasm")),
		);
		expect(wasmRoot).toBe(
			realpathSync(join(threeRevisionRoot, "rust/wasm/pkg")),
		);
		expect(wasmSha256).toBe(
			"084cf7310df5bfdc1b8e4ce3f64bcff842e1b23b9fd0ca57c1c7dcffc0d1fc12",
		);
		const before = await pinInkHostToolchain(toolchain!);
		const probeFiles = [
			"apps/cli/src/__tests__/programmatic-three-build-revision-fixture.ts",
			"apps/cli/src/__tests__/programmatic-three-build-revision.test.ts",
		];
		const probeHashes = () =>
			Promise.all(
				probeFiles.map(async (path) => ({
					path,
					sha256: threeRevisionDigest(
						await readFile(join(threeRevisionRoot, path)),
					),
				})),
			);
		const probeFilesBefore = await probeHashes();
		const fixture = await threeRevisionFixture(toolchain!);
		const evidence: Record<string, unknown> = {
			version: 1,
			ok: false,
			startedAt: new Date().toISOString(),
			sourceHead: head,
			wasmRoot,
			wasmSha256,
			artifacts: fixture.root,
			previousAttempts: fixture.previousAttempts,
			historicalOrderingFailureExplanation:
				"The first run failed only on unordered Host track query results after reopen. Its preceding raw project.json byte check passed. Current snapshots sort identity collections by id, matching the established glass-editor Host probe; byte and full resource-ledger checks remain exact.",
			probeFilesBefore,
			runtime: {
				bun: Bun.version,
				node: process.versions.node,
				platform: process.platform,
			},
			testCommand:
				"bun test apps/cli/src/__tests__/programmatic-three-build-revision.test.ts",
			testEnvironment: { ROCUT_TEST_THREE_BUILD_REVISION_TOOLCHAIN: toolchain },
			scope:
				"Real ordinary Three compiler and real file-backed Host apply/save/close/reopen, no mocks. No browser, GPU, frame capture or export exercised.",
			toolchainBefore: before,
			gpuTested: false,
			frameTested: false,
			exportTested: false,
		};
		try {
			const initial = await fixture.success("compile", fixture.spec);
			const initialJson = JSON.stringify(initial.source);
			if (!initial.source.build) throw Error("Missing initial Three build");
			expect(initial.source.build.engine).toBe("three");
			expect(initial.source.build.engineVersion).toBe("0.185.1");
			const context = await fixture.request("context");
			const editing = (source: typeof initial.source) => ({
				type: "graphic",
				name: "Three archive revision",
				definitionId: "programmatic",
				params: {},
				effects: [],
				programmatic: source,
			});
			await fixture.request("apply", {
				expectedRevision: context.revision,
				operations: [
					{
						kind: "update-project",
						projectId: context.project.id,
						patch: {
							name: "Three archive revision acceptance",
							canvasWidth: 64,
							canvasHeight: 64,
							frameRate: fixture.spec.frameRate,
						},
					},
					{
						kind: "create-track",
						track: {
							id: "three-revision-track",
							name: "Three",
							kind: "graphic",
							hidden: false,
						},
					},
					{
						kind: "create-clip",
						clip: {
							id: "three-revision-clip",
							trackId: "three-revision-track",
							startTime: 0,
							duration: 240000,
							trimStart: 0,
							trimEnd: 0,
							editing: editing(initial.source),
						},
					},
				],
			});
			evidence.authorMovedTo = await fixture.moveAuthor();
			const initialResources = await fixture.resources(initial.source);
			const failureControls: unknown[] = [];
			const rejectUnchanged = async (
				name: string,
				input: unknown,
				message?: string,
			) => {
				const record = await fixture.recordBytes(),
					snapshot = await fixture.snapshot(),
					ledger = await fixture.ledger();
				const response = await fixture.post("revise", input),
					body = await response.text();
				expect(response.status).toBe(422);
				if (message) expect(body).toContain(message);
				expect(await fixture.recordBytes()).toEqual(record);
				expect(await fixture.snapshot()).toEqual(snapshot);
				expect(await fixture.ledger()).toEqual(ledger);
				expect(await fixture.resources(initial.source)).toEqual(
					initialResources,
				);
				expect(JSON.stringify(initial.source)).toBe(initialJson);
				failureControls.push({
					name,
					status: response.status,
					projectSha256: threeRevisionDigest(record),
					snapshotSha256: threeRevisionDigest(JSON.stringify(snapshot)),
					ledgerSha256: threeRevisionDigest(JSON.stringify(ledger)),
					unchanged: true,
				});
			};
			for (const id of [
				"../escape.ts",
				"C:/escape.ts",
				"node_modules/evil.ts",
				"_rocut/evil.ts",
				"CON.ts",
				"pixel.png",
			])
				await rejectUnchanged(`unsafe-add:${id}`, {
					source: initial.source,
					changes: [{ op: "add", id, code: "export const x=1;" }],
				});
			await rejectUnchanged("delete-current-entry", {
				source: initial.source,
				changes: [{ op: "delete", id: "main.ts" }],
			});
			await rejectUnchanged("rename-collision", {
				source: initial.source,
				changes: [{ op: "rename", id: "main.ts", to: "old-helper.ts" }],
			});
			await rejectUnchanged("invalid-props", {
				source: initial.source,
				changes: [],
				inputProps: null,
			});
			await rejectUnchanged(
				"failed-real-compiler",
				{
					source: initial.source,
					changes: [{ id: "main.ts", code: "export function createScene( {" }],
				},
				"Engine compiler failed",
			);
			evidence.failureControls = failureControls;
			const renamed = await fixture.success("revise", {
				source: initial.source,
				changes: [
					{ op: "add", id: "new-helper.ts", code: revisedThreeHelper },
					{ op: "rename", id: "main.ts", to: "start.ts" },
				],
			});
			expect(renamed.source.build?.entryFile).toBe("start.ts");
			const props = { label: "revised-prop", color: 0xd03060, scale: 1.25 };
			const revised = await fixture.success("revise", {
				source: renamed.source,
				changes: [
					{ id: "start.ts", code: revisedThreeEntry },
					{ op: "delete", id: "old-helper.ts" },
				],
				inputProps: props,
			});
			expect(revised.reusedDocument).toBe(false);
			expect(
				revised.source.build?.inputs.map((item) => item.id).sort(),
			).toEqual(["new-helper.ts", "pixel.png", "start.ts"]);
			expect(revised.source.build?.inputProps).toEqual(props);
			expect(
				revised.source.build?.inputs.find((item) => item.id === "pixel.png"),
			).toEqual(
				initial.source.build.inputs.find((item) => item.id === "pixel.png"),
			);
			expect(revised.source.build?.toolchainLock).toEqual(
				initial.source.build.toolchainLock,
			);
			expect(threeRevisionDigest(JSON.stringify(revised.source))).not.toBe(
				threeRevisionDigest(initialJson),
			);
			expect(JSON.stringify(initial.source)).toBe(initialJson);
			expect(await fixture.resources(initial.source)).toEqual(initialResources);
			const document = revised.source.resources?.find(
				(item) => item.id === revised.source.documentId,
			);
			if (!document) throw Error("Missing revised compiled document");
			const documentText = new TextDecoder("utf-8", { fatal: true }).decode(
				(
					await loadProgrammaticResource({
						...fixture.context,
						resource: document,
					})
				).body,
			);
			expect(documentText).toContain("THREE_ARCHIVE_NEW_HELPER");
			expect(documentText).toContain("revised-prop");
			expect(document.sha256).not.toBe(
				initial.source.resources?.find(
					(item) => item.id === initial.source.documentId,
				)?.sha256,
			);
			const initialEntry = initial.source.build.inputs.find(
				(item) => item.id === "main.ts",
			)!;
			expect(
				new TextDecoder("utf-8", { fatal: true }).decode(
					(
						await loadProgrammaticResource({
							...fixture.context,
							resource: initialEntry,
						})
					).body,
				),
			).toBe(originalThreeEntry);
			expect(await fixture.success("rebuild", initial.source)).toEqual({
				source: initial.source,
				reusedDocument: true,
			});
			expect(await fixture.success("rebuild", revised.source)).toEqual({
				source: revised.source,
				reusedDocument: true,
			});
			const applyContext = await fixture.request("context");
			await fixture.request("apply", {
				expectedRevision: applyContext.revision,
				operations: [
					{
						kind: "update-clip",
						clipId: "three-revision-clip",
						patch: { editing: editing(revised.source) },
					},
				],
			});
			const persisted = await fixture.recordBytes(),
				snapshot = await fixture.snapshot(),
				ledger = await fixture.ledger(),
				revisedResources = await fixture.resources(revised.source);
			expect(
				snapshot.clips.find((clip) => clip.id === "three-revision-clip"),
			).toMatchObject({
				editing: { type: "graphic", programmatic: revised.source },
			});
			await fixture.reopen();
			expect(await fixture.recordBytes()).toEqual(persisted);
			expect(await fixture.snapshot()).toEqual(snapshot);
			expect(await fixture.ledger()).toEqual(ledger);
			expect(await fixture.resources(initial.source)).toEqual(initialResources);
			expect(await fixture.resources(revised.source)).toEqual(revisedResources);
			expect(await fixture.success("rebuild", initial.source)).toEqual({
				source: initial.source,
				reusedDocument: true,
			});
			expect(await fixture.success("rebuild", revised.source)).toEqual({
				source: revised.source,
				reusedDocument: true,
			});
			expect(await fixture.recordBytes()).toEqual(persisted);
			evidence.workflowSucceeded = true;
			evidence.initial = {
				sourceSha256: threeRevisionDigest(initialJson),
				source: initial.source,
				resources: initialResources,
			};
			evidence.renameAndAdd = {
				source: renamed.source,
				sourceSha256: threeRevisionDigest(JSON.stringify(renamed.source)),
			};
			evidence.revised = {
				sourceSha256: threeRevisionDigest(JSON.stringify(revised.source)),
				source: revised.source,
				resources: revisedResources,
			};
			evidence.persistence = {
				clipReferencesRevisedSource: true,
				projectByteIdenticalAfterReopen: true,
				projectSha256: threeRevisionDigest(persisted),
				snapshot,
				attachmentLedger: ledger,
				oldAndNewArchiveRebuiltBeforeAndAfterReopen: true,
			};
		} catch (error) {
			evidence.error = {
				message: String(error),
				stack: error instanceof Error ? error.stack : undefined,
			};
			throw error;
		} finally {
			await fixture.close();
			const after = await pinInkHostToolchain(toolchain!);
			const probeFilesAfter = await probeHashes();
			const wasmSha256After = threeRevisionDigest(
				await readFile(join(wasmRoot, "opencut_wasm_bg.wasm")),
			);
			evidence.toolchainAfter = after;
			evidence.toolchainUnchanged =
				JSON.stringify(before) === JSON.stringify(after);
			evidence.probeFilesAfter = probeFilesAfter;
			evidence.probeFilesUnchanged =
				JSON.stringify(probeFilesBefore) === JSON.stringify(probeFilesAfter);
			evidence.wasmSha256After = wasmSha256After;
			evidence.wasmUnchanged = wasmSha256After === wasmSha256;
			evidence.ok =
				evidence.workflowSucceeded === true &&
				evidence.toolchainUnchanged === true &&
				evidence.probeFilesUnchanged === true &&
				evidence.wasmUnchanged === true;
			evidence.finishedAt = new Date().toISOString();
			await fixture.writeEvidence(evidence);
			expect(after).toEqual(before);
			expect(probeFilesAfter).toEqual(probeFilesBefore);
			expect(wasmSha256After).toBe(wasmSha256);
		}
	},
	120000,
);
