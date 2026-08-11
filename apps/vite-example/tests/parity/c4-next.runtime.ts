import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

import { waitForEditor } from "./driver";
import { HOST_PROFILE } from "./host-profile";

const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = resolve(
	HERE,
	"../../../../rasen/changes/s0304-surface-mount-focus-lifecycle/evidence/browser-surface/next",
);

async function readProbeResult(page: Page): Promise<Record<string, unknown>> {
	const probe = page.getByTestId("c4-next-runtime-probe");
	await expect(probe).toHaveAttribute("data-status", "ready", {
		timeout: 180_000,
	});
	const raw = await probe.getAttribute("data-result");
	if (!raw) throw new Error("C4 Next runtime probe produced no result.");
	return JSON.parse(raw) as Record<string, unknown>;
}

test("C4 Next worker and forced-none probes start only after project load", async ({
	page,
}) => {
	expect(HOST_PROFILE.name).toBe("next");
	mkdirSync(EVIDENCE_DIR, { recursive: true });
	await page.addInitScript(() => {
		localStorage.setItem("hasSeenOnboarding", "true");
	});
	await page.goto(HOST_PROFILE.entryPath);
	await HOST_PROFILE.createProject(page);
	await waitForEditor(page);
	const editorPath = new URL(page.url()).pathname;

	await page.goto(`${editorPath}?c4-next-probe=worker`);
	const worker = await readProbeResult(page);
	expect(worker.response).toEqual({ kind: "pong", byteLength: 4 });
	expect(worker.created).toBe(1);
	expect(worker.released).toBe(1);
	expect(worker.pageErrors).toEqual([]);
	expect(worker.unhandledRejections).toEqual([]);
	expect(String(worker.rewrittenUrl)).toContain(
		"/workers/c4-worker-fixture.js",
	);
	await page.screenshot({
		path: resolve(EVIDENCE_DIR, "07-c4-worker-post-load.png"),
		fullPage: true,
	});

	await page.goto(`${editorPath}?c4-next-probe=forced-none`);
	const forced = await readProbeResult(page);
	const report = forced.report as {
		rasterizer?: string;
		backend?: unknown;
		livePreviewLimit?: number;
		reason?: string;
		source?: string;
	};
	expect(report.rasterizer).toBe("none");
	expect(report.backend).toBeNull();
	expect(report.livePreviewLimit).toBe(0);
	expect(report.reason).toBe("host declared no rasterizer");
	expect(report.source).toBe("host-forced");
	expect(forced.sessionState).toBe("mounted");
	expect(forced.bannerVisible).toBe(true);
	expect(forced.previewUnavailableVisible).toBe(true);
	expect(forced.effectPreviewCount).toBeGreaterThanOrEqual(1);
	expect(forced.renderTreeIsNull).toBe(true);
	expect(forced.compositorHandle).toBeNull();
	expect(forced.gpuWorkCount).toBe(0);
	expect(forced.pageErrors).toEqual([]);
	expect(forced.unhandledRejections).toEqual([]);
	await page.screenshot({
		path: resolve(EVIDENCE_DIR, "08-c4-forced-none-post-load.png"),
		fullPage: true,
	});
});
