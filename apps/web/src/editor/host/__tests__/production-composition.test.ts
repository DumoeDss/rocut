import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type { EditorHost } from "../editor-host";
import {
	BrowserAssetResolver,
	BrowserRuntimeAssetLoader,
	BrowserRuntimeResourceHost,
} from "../browser-runtime";

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
	await import("../../session/__tests__/wasm-test-mock");
	const [
		{ createNextEditorHost },
		{ createViteEditorHost },
		storage,
		{ createEditorSession },
		{ createInMemoryHost },
		{ InMemoryProjectStore },
		{ editorForSession },
	] = await Promise.all([
		import("../next-editor-host"),
		import("../../../../../vite-example/src/host/vite-host-config"),
		import("@/services/storage/browser-project-store"),
		import("../../session/create-session"),
		import("../../ports/in-memory/host"),
		import("../../ports/in-memory"),
		import("../../runtime/session-core-owner"),
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
