import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type { EditorHost } from "@opencut/editor-ports/host";
import {
	BrowserAssetResolver,
	BrowserRuntimeAssetLoader,
	BrowserRuntimeResourceHost,
} from "@opencut/editor-classic/browser";

if (process.env.OPENCUT_C5_HOST_TEST_ISOLATED !== "1") {
	test("production Host composition runs in an isolated wasm-mock process", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			cwd: process.cwd(),
			env: {
				...process.env,
				OPENCUT_C5_HOST_TEST_ISOLATED: "1",
			},
			stderr: "pipe",
			stdout: "pipe",
		});
		if (result.exitCode !== 0) {
			throw new Error(
				`isolated production Host composition suite failed:\n${result.stdout.toString()}\n${result.stderr.toString()}`,
			);
		}
	});
} else {
	// Must be its own standalone, sequentially-awaited import — see
	// packages/editor-classic/src/evidence/index.ts's header comment. Bun
	// does not guarantee this mock installs before the real "opencut-wasm"
	// package if it's pulled in as one of several independent `export *`
	// targets inside a shared barrel (i.e. importing the full "evidence"
	// entry here instead is not equivalent and will crash on real wasm init).
	await import("@opencut/editor-classic/evidence/wasm-test-mock");
	const [
		{ createNextEditorHost },
		{ createViteEditorHost },
		storage,
		{ createEditorSession },
		{ createInMemoryHost },
		{ InMemoryProjectStore },
		{ editorForSession },
		{ captureDurableBrowserStoreAttribution },
	] = await Promise.all([
		import("../next-editor-host"),
		import("../../../../../vite-example/src/host/vite-host-config"),
		import("@opencut/editor-classic/storage"),
		import("@opencut/editor-classic/session"),
		import("@opencut/editor-ports/in-memory/host"),
		import("@opencut/editor-ports/in-memory"),
		import("@opencut/editor-classic/runtime"),
		import("@opencut/editor-classic/evidence"),
	]);

	function expectBrowserRoles(host: EditorHost): void {
		expect(host.assets).toBeInstanceOf(BrowserAssetResolver);
		expect(host.assetLoader).toBeInstanceOf(BrowserRuntimeAssetLoader);
		expect(host.runtimeResources).toBeInstanceOf(BrowserRuntimeResourceHost);
		expect(Object.isFrozen(host.assets)).toBe(true);
		expect(host.store).toBeInstanceOf(storage.BrowserProjectStore);
	}

	function nextHost(projectId: string): EditorHost {
		return createNextEditorHost({
			projectId,
			base: "/c5-next/",
			onProjectReplaced: () => {},
			onExitProject: () => {},
			onGoBack: () => {},
		});
	}

	function viteHost(projectId: string): EditorHost {
		return createViteEditorHost({
			projectId,
			base: "/c5-vite/",
			onProjectIdChange: () => {},
			onExitProject: () => {},
		});
	}

	describe("production Host browser composition", () => {
		test("Next final-overrides all production browser roles", () => {
			const host = nextHost("next");
			expectBrowserRoles(host);
			expect(host.branding.logoUrl).toBe("/c5-next/logos/opencut/svg/logo.svg");
			expect(host.services).toEqual({
				soundSearchEndpoint: "/c5-next/api/sounds/search",
				feedbackEndpoint: "/c5-next/api/feedback",
			});
		});

		test("Vite final-overrides all production browser roles", () => {
			const host = viteHost("vite");
			expectBrowserRoles(host);
			expect(host.branding.logoUrl).toBe("/c5-vite/logos/opencut/svg/logo.svg");
			expect(host.services).toEqual({});
		});

		test("each Host root reuses one stable durable store across sessions", () => {
			const nextA = nextHost("next-a");
			const nextB = nextHost("next-b");
			const viteA = viteHost("vite-a");
			const viteB = viteHost("vite-b");
			expect(nextA.store).toBe(nextB.store);
			expect(viteA.store).toBe(viteB.store);
			expect(nextA.store).not.toBe(viteA.store);
		});

		test("durable attribution ignores a minified constructor name", () => {
			class fQe extends storage.BrowserProjectStore {}
			const attribution = captureDurableBrowserStoreAttribution({
				store: new fQe(),
				isDurableBrowserStore: (store) =>
					store instanceof storage.BrowserProjectStore,
			});

			expect(attribution.instanceOfBrowserProjectStore).toBe(true);
			expect(attribution.constructorName).toBe("fQe");
		});

		test("durable attribution rejects the reference store", () => {
			const attribution = captureDurableBrowserStoreAttribution({
				store: new InMemoryProjectStore(),
				isDurableBrowserStore: (store) =>
					store instanceof storage.BrowserProjectStore,
			});

			expect(attribution.instanceOfBrowserProjectStore).toBe(false);
			expect(attribution.constructorName).toBe("InMemoryProjectStore");
		});

		test("fresh Host factories allocate distinct process-lifetime session IDs", async () => {
			const nextHosts = [nextHost("next-id-a"), nextHost("next-id-b")];
			const viteHosts = [viteHost("vite-id-a"), viteHost("vite-id-b")];
			const nextSessions = await Promise.all(
				nextHosts.map((host) =>
					createEditorSession({
						host: { ...host, store: new InMemoryProjectStore() },
					}),
				),
			);
			const viteSessions = await Promise.all(
				viteHosts.map((host) =>
					createEditorSession({
						host: { ...host, store: new InMemoryProjectStore() },
					}),
				),
			);
			try {
				expect(nextSessions[0]!.id).not.toBe(nextSessions[1]!.id);
				expect(viteSessions[0]!.id).not.toBe(viteSessions[1]!.id);
			} finally {
				await Promise.all(
					[...nextSessions, ...viteSessions].map((session) =>
						session.dispose(),
					),
				);
			}
		});

		test("stabilizes only ids alongside the established store policy", () => {
			for (const hosts of [
				[nextHost("next-role-a"), nextHost("next-role-b")],
				[viteHost("vite-role-a"), viteHost("vite-role-b")],
			]) {
				const [first, second] = hosts;
				expect(first!.ids).toBe(second!.ids);
				expect(first!.store).toBe(second!.store);
				// Diagnostics is an existing module-stable production channel. Every
				// other reference role remains fresh per Host composition.
				expect(first!.diagnostics).toBe(second!.diagnostics);
				for (const role of [
					"assets",
					"assetLoader",
					"runtimeResources",
					"exporter",
					"environment",
				] as const) {
					expect(first![role]).not.toBe(second![role]);
				}
			}
		});

		test("two sessions share committed storage but not coordinators or caches", async () => {
			const store = new InMemoryProjectStore();
			const [sessionA, sessionB] = await Promise.all([
				createEditorSession({
					host: createInMemoryHost({ projectId: "shared-a", store }),
				}),
				createEditorSession({
					host: createInMemoryHost({ projectId: "shared-b", store }),
				}),
			]);
			const editorA = editorForSession(sessionA);
			const editorB = editorForSession(sessionB);
			expect(sessionA.host.store).toBe(sessionB.host.store);
			expect(editorA.persistence).not.toBe(editorB.persistence);

			const projectId = await editorA.project.createNewProject({
				name: "Shared durable project",
			});
			expect(
				editorA.persistence.readCachedProject({ id: projectId }),
			).not.toBeNull();
			expect(
				editorB.persistence.readCachedProject({ id: projectId }),
			).toBeNull();
			expect(
				await editorB.persistence.loadProject({ id: projectId }),
			).not.toBeNull();

			await Promise.all([sessionA.dispose(), sessionB.dispose()]);
		});

		test("Vite can declare forced-none without stamping runtime facts", () => {
			const host = createViteEditorHost({
				projectId: "vite-forced-none",
				base: "/c5-vite/",
				onProjectIdChange: () => {},
				onExitProject: () => {},
				forceRendererBackend: "none",
			});

			const graphics = host.environment.describeGraphics();
			expect(graphics).toEqual({
				mode: "force",
				rasterizer: "none",
			});
			expect(graphics).not.toHaveProperty("backend");
			expect(graphics).not.toHaveProperty("livePreviewLimit");
		});
	});
}
