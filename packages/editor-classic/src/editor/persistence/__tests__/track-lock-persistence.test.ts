import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

if (process.env.OPENCUT_TRACK_LOCK_LEGACY_CHILD === "1") {
	const { mock } = await import("bun:test");
	const actual = await import("opencut-wasm/sync");
	const legacy = { ...actual };
	Reflect.deleteProperty(legacy, "validateTrackLocksJson");
	mock.module("opencut-wasm", () => legacy);
	const { projectFixture } =
		await import("../../transactions/opencut/__tests__/fixture");
	const { encodeProject, decodeProject } = await import("../project-codec");
	const { assertNativeTrackLocks } =
		await import("../../transactions/opencut/track-lock-policy");
	const { trackLockValidator } =
		await import("../../transactions/opencut/track-lock-runtime");
	test("old WASM imports safely, edits unlocked projects, and rejects lock/v2 downgrade", () => {
		expect(trackLockValidator()).toBeUndefined();
		const project = projectFixture();
		const record = encodeProject({ project, retained: {} });
		if (typeof record !== "object" || record === null)
			throw new Error("Missing encoded fixture");
		expect(decodeProject(record).scenes[0].tracks.main.locked).toBeUndefined();
		expect(() =>
			assertNativeTrackLocks({ before: project, after: project }),
		).not.toThrow();
		project.scenes[0].tracks.main.locked = true;
		expect(() => encodeProject({ project, retained: {} })).toThrow("Upgrade");
		expect(() => decodeProject({ ...record, scenes: project.scenes })).toThrow(
			"Upgrade",
		);
		expect(() =>
			decodeProject({ ...record, __opencutTransaction: { version: 2 } }),
		).toThrow("Upgrade");
	});
} else {
	test("legacy runtime compatibility is exercised in an isolated process", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			cwd: process.cwd(),
			env: {
				...process.env,
				OPENCUT_TRACK_LOCK_LEGACY_CHILD: "1",
				ROCUT_TEST_WASM_DIRECTORY: "",
			},
			stdout: "pipe",
			stderr: "pipe",
		});
		if (result.exitCode !== 0)
			throw new Error(result.stdout.toString() + result.stderr.toString());
	});
	await import("../../session/__tests__/wasm-test-mock");
	const { SessionPersistenceCoordinator } =
		await import("../session-persistence-coordinator");
	const {
		projectFixture,
		recordFixture,
		storeFixture,
		TEST_PROJECT_ID,
		motionTextSequenceFixture,
	} = await import("../../transactions/opencut/__tests__/fixture");
	const { assetId, mediaTime, motionTextFontId, revisionOf } =
		await import("@opencut/editor-contracts");
	const { projectOpenCutDraft } =
		await import("../../transactions/opencut/projection");
	const { assertPublicTrackLocks } =
		await import("../../transactions/opencut/track-lock-policy");
	const { sourceBytesSha256 } = await import("../../../media/media-facts");
	const { cloneOpaque } = await import("../opaque-value");
	const { trackLockValidator } =
		await import("../../transactions/opencut/track-lock-runtime");
	const nativeAvailable = !!trackLockValidator();
	if (process.env.ROCUT_TEST_WASM_DIRECTORY && !nativeAvailable)
		throw new Error(
			"Selected candidate must provide native track lock admission",
		);
	const nativeTest = test.skipIf(!nativeAvailable);
	function lockedProject() {
		const project = projectFixture();
		project.scenes[0].tracks.main.locked = true;
		project.scenes[0].tracks.main.elements.push({
			id: "clip",
			name: "clip",
			type: "video",
			mediaId: "media",
			startTime: project.metadata.duration,
			duration: project.metadata.duration,
			trimStart: project.metadata.duration,
			trimEnd: project.metadata.duration,
			params: {},
		});
		return project;
	}
	const original = new Uint8Array([1, 2, 3]).buffer;
	async function harness() {
		const project = lockedProject();
		const fixture = await storeFixture(project);
		await fixture.store.saveAttachment({
			projectId: TEST_PROJECT_ID,
			key: "media",
			metadata: {},
			body: original,
		});
		return {
			...fixture,
			project,
			persistence: new SessionPersistenceCoordinator(fixture.store),
		};
	}
	nativeTest(
		"fresh coordinator cannot overwrite a locked scene without loading it first",
		async () => {
			const h = await harness();
			const before = await h.store.load({ id: TEST_PROJECT_ID });
			const project = cloneOpaque(h.project);
			project.scenes[0].tracks.main.elements = [];
			await expect(h.persistence.saveProject({ project })).rejects.toThrow(
				"locked",
			);
			expect(await h.store.load({ id: TEST_PROJECT_ID })).toEqual(before);
		},
	);
	nativeTest(
		"direct attachment deletion and changed bytes are rejected; identical bytes and facts are allowed",
		async () => {
			const h = await harness();
			const request = { projectId: TEST_PROJECT_ID, key: "media" };
			await expect(h.persistence.removeAttachment(request)).rejects.toThrow(
				"locked",
			);
			await expect(
				h.persistence.saveAttachment({
					...request,
					metadata: { sourceSha256: "lying-metadata" },
					body: new Uint8Array([9]).buffer,
				}),
			).rejects.toThrow("locked");
			expect((await h.store.loadAttachment(request))?.body).toEqual(original);
			await h.persistence.saveAttachment({
				...request,
				metadata: { facts: "enriched" },
				body: original.slice(0),
			});
			expect((await h.store.loadAttachment(request))?.body).toEqual(original);
		},
	);
	nativeTest(
		"offline source restoration uses retained source digest rather than supplied metadata",
		async () => {
			const project = lockedProject();
			const h = await storeFixture(project);
			const digest = await sourceBytesSha256(new Uint8Array(original));
			await h.store.save({
				record: recordFixture(project, {
					__opencutTransaction: {
						version: 2,
						revision: 0,
						idempotency: [],
						assetCatalog: [
							{
								id: "media",
								name: "media",
								type: "video",
								sourceSha256: digest,
							},
						],
					},
				}),
				summary: {
					id: TEST_PROJECT_ID,
					name: "locked",
					createdAt: project.metadata.createdAt.toISOString(),
					updatedAt: project.metadata.updatedAt.toISOString(),
				},
			});
			const persistence = new SessionPersistenceCoordinator(h.store);
			const request = { projectId: TEST_PROJECT_ID, key: "media" };
			await expect(
				persistence.saveAttachment({
					...request,
					metadata: { sourceSha256: digest },
					body: new Uint8Array([9]).buffer,
				}),
			).rejects.toThrow("locked");
			expect(await h.store.loadAttachment(request)).toBeNull();
			await persistence.saveAttachment({
				...request,
				metadata: {},
				body: original,
			});
			expect((await h.store.loadAttachment(request))?.body).toEqual(original);
		},
	);
	nativeTest(
		"unfingerprinted offline locked sources fail closed and unrelated attachments remain usable",
		async () => {
			const project = lockedProject();
			const h = await storeFixture(project);
			const persistence = new SessionPersistenceCoordinator(h.store);
			await expect(
				persistence.saveAttachment({
					projectId: TEST_PROJECT_ID,
					key: "media",
					metadata: {},
					body: original,
				}),
			).rejects.toThrow("locked");
			await persistence.saveAttachment({
				projectId: TEST_PROJECT_ID,
				key: "unrelated",
				metadata: {},
				body: original,
			});
			await persistence.removeAttachment({
				projectId: TEST_PROJECT_ID,
				key: "unrelated",
			});
		},
	);
	nativeTest(
		"pending project lock publication wins before direct attachment removal",
		async () => {
			const project = lockedProject();
			project.scenes[0].tracks.main.locked = false;
			const h = await storeFixture(project);
			await h.store.saveAttachment({
				projectId: TEST_PROJECT_ID,
				key: "media",
				metadata: {},
				body: original,
			});
			const persistence = new SessionPersistenceCoordinator(h.store);
			const locked = cloneOpaque(project);
			locked.scenes[0].tracks.main.locked = true;
			const saving = persistence.saveProject({ project: locked });
			const removing = persistence.removeAttachment({
				projectId: TEST_PROJECT_ID,
				key: "media",
			});
			await saving;
			await expect(removing).rejects.toThrow("locked");
			expect(
				(
					await h.store.loadAttachment({
						projectId: TEST_PROJECT_ID,
						key: "media",
					})
				)?.body,
			).toEqual(original);
		},
	);
	nativeTest(
		"public native admission allows first SHA enrichment but rejects changes and null clearing",
		() => {
			const before = projectOpenCutDraft(
				{
					project: lockedProject(),
					assetCatalog: [{ id: "media", name: "media", type: "video" }],
				},
				{ revision: revisionOf(0), idempotency: [] },
			);
			const known = cloneOpaque(before);
			Reflect.set(known.assets[0], "sourceSha256", "a".repeat(64));
			expect(() =>
				assertPublicTrackLocks({ before, after: known }),
			).not.toThrow();
			for (const value of ["b".repeat(64), null, undefined]) {
				const changed = cloneOpaque(known);
				Reflect.set(changed.assets[0], "sourceSha256", value);
				expect(() =>
					assertPublicTrackLocks({ before: known, after: changed }),
				).toThrow("locked");
			}
		},
	);
	nativeTest(
		"motion-text audio and project fonts cannot be deleted or relinked through public or attachment boundaries",
		async () => {
			const project = projectFixture();
			const sequence = {
				...motionTextSequenceFixture(),
				audioBinding: {
					assetId: assetId("audio"),
					sourceOffset: mediaTime({ ticks: 0 }),
				},
				fonts: [
					{
						id: motionTextFontId("font"),
						source: "project" as const,
						family: "Custom",
						style: "normal" as const,
						weight: 400,
						assetId: assetId("font"),
					},
				],
			};
			project.motionTextSequences = [sequence];
			project.scenes[0].tracks.overlay.push({
				id: "motion",
				name: "Motion",
				type: "graphic",
				hidden: false,
				locked: true,
				elements: [
					{
						id: "motion-clip",
						name: "motion",
						type: "motion-text",
						sequenceId: sequence.id,
						startTime: mediaTime({ ticks: 0 }),
						duration: sequence.duration,
						trimStart: mediaTime({ ticks: 0 }),
						trimEnd: mediaTime({ ticks: 0 }),
						params: {},
					},
				],
			});
			const h = await storeFixture(project);
			const persistence = new SessionPersistenceCoordinator(h.store);
			for (const id of ["audio", "font"])
				await h.store.saveAttachment({
					projectId: TEST_PROJECT_ID,
					key: id,
					metadata: {},
					body: original,
				});
			const document = projectOpenCutDraft(
				{
					project,
					assetCatalog: [
						{
							id: "audio",
							name: "audio",
							type: "audio",
							sourceSha256: "a".repeat(64),
						},
						{
							id: "font",
							name: "font",
							type: "image",
							sourceSha256: "a".repeat(64),
						},
					],
				},
				{ revision: revisionOf(0), idempotency: [] },
			);
			for (const id of ["audio", "font"]) {
				const request = { projectId: TEST_PROJECT_ID, key: id };
				await expect(persistence.removeAttachment(request)).rejects.toThrow(
					"locked",
				);
				await expect(
					persistence.saveAttachment({
						...request,
						metadata: {},
						body: new Uint8Array([9]).buffer,
					}),
				).rejects.toThrow("locked");
				await persistence.saveAttachment({
					...request,
					metadata: {},
					body: original.slice(0),
				});
				const removed = {
					...document,
					assets: document.assets.filter((asset) => asset.id !== id),
				};
				expect(() =>
					assertPublicTrackLocks({ before: document, after: removed }),
				).toThrow("locked");
				const relinked = cloneOpaque(document);
				const asset = relinked.assets.find((asset) => asset.id === id);
				if (!asset) throw new Error("Missing projected dependency");
				Reflect.set(asset, "sourceSha256", "b".repeat(64));
				expect(() =>
					assertPublicTrackLocks({ before: document, after: relinked }),
				).toThrow("locked");
			}
		},
	);
}
