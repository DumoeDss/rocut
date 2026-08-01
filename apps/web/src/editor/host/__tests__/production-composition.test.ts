import { describe, expect, test } from "bun:test";
import {
	BrowserAssetResolver,
	BrowserRuntimeAssetLoader,
	BrowserRuntimeResourceHost,
} from "../browser-runtime";
import { createNextEditorHost } from "../next-editor-host";
import { createViteEditorHost } from "../../../../../vite-example/src/host/vite-host-config";

function expectBrowserRoles(
	host: ReturnType<typeof createNextEditorHost>,
): void {
	expect(host.assets).toBeInstanceOf(BrowserAssetResolver);
	expect(host.assetLoader).toBeInstanceOf(BrowserRuntimeAssetLoader);
	expect(host.runtimeResources).toBeInstanceOf(BrowserRuntimeResourceHost);
	expect(Object.isFrozen(host.assets)).toBe(true);
}

describe("production Host C4 role composition", () => {
	test("Next overrides all three reference roles after the in-memory spread", () => {
		const host = createNextEditorHost({
			projectId: "next",
			base: "/c4-next/",
			onProjectReplaced: () => {},
			onExitProject: () => {},
			onGoBack: () => {},
		});
		expectBrowserRoles(host);
		expect(host.branding.logoUrl).toBe("/c4-next/logos/opencut/svg/logo.svg");
		expect(host.services).toEqual({
			soundSearchEndpoint: "/c4-next/api/sounds/search",
			feedbackEndpoint: "/c4-next/api/feedback",
		});
	});

	test("Vite overrides all three reference roles and keeps unsupported services absent", () => {
		const host = createViteEditorHost({
			projectId: "vite",
			base: "/c4-vite/",
			onProjectIdChange: () => {},
			onExitProject: () => {},
		});
		expectBrowserRoles(host);
		expect(host.branding.logoUrl).toBe("/c4-vite/logos/opencut/svg/logo.svg");
		expect(host.services).toEqual({});
	});

	test("Vite can declare forced-none without stamping runtime facts", () => {
		const host = createViteEditorHost({
			projectId: "vite-forced-none",
			base: "/c4-vite/",
			onProjectIdChange: () => {},
			onExitProject: () => {},
			forceRendererBackend: "none",
		});

		const graphics = host.environment?.describeGraphics();
		expect(graphics).toEqual({
			mode: "force",
			rasterizer: "none",
		});
		expect(graphics).not.toHaveProperty("backend");
		expect(graphics).not.toHaveProperty("livePreviewLimit");
	});
});
