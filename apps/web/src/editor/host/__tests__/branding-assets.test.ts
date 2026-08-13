import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadImage } from "@napi-rs/canvas";

import { createNextEditorHost } from "../next-editor-host";
import { createViteEditorHost } from "../../../../../vite-example/src/host/vite-host-config";

describe("base-aware Host branding", () => {
	test("keeps both Host logos and Vite favicon below their configured bases", () => {
		const next = createNextEditorHost({
			projectId: "next-branding",
			base: "/c4-next/",
			onProjectReplaced: () => {},
			onExitProject: () => {},
			onGoBack: () => {},
		});
		const vite = createViteEditorHost({
			projectId: "vite-branding",
			base: "/c4-vite/",
			onProjectIdChange: () => {},
			onExitProject: () => {},
		});
		expect(next.branding.logoUrl).toBe(
			"/c4-next/logos/opencut/svg/logo.svg",
		);
		expect(vite.branding.logoUrl).toBe(
			"/c4-vite/logos/opencut/svg/logo.svg",
		);
		expect("/c4-vite/favicon.ico").toStartWith("/c4-vite/");
	});

	test("decodes non-empty logo and favicon pixels, not status alone", async () => {
		const publicRoot = resolve(process.cwd(), "apps/web/public");
		const logoBytes = await readFile(
			resolve(publicRoot, "logos/opencut/svg/logo.svg"),
		);
		const faviconBytes = await readFile(resolve(publicRoot, "favicon.ico"));
		expect(logoBytes.byteLength).toBeGreaterThan(0);
		expect(faviconBytes.byteLength).toBeGreaterThan(0);

		const [logo, favicon] = await Promise.all([
			loadImage(logoBytes),
			loadImage(faviconBytes),
		]);
		expect(logo.width).toBeGreaterThan(0);
		expect(logo.height).toBeGreaterThan(0);
		expect(favicon.width).toBeGreaterThan(0);
		expect(favicon.height).toBeGreaterThan(0);
	});
});
