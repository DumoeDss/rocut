/**
 * The embed-surface boot smoke (S05 P6, design E2.2).
 *
 * Build success alone is not execution — the P1 vite Blocker is the precedent.
 * This smoke serves ./dist on a local static server and drives headless
 * Chromium through Playwright: mount assertions, the GPU-free degraded-banner
 * proof, two real interactions (a focus-scope click and a timeline ruler scrub
 * that moves the playhead), and a clean-boot gate scoped to tolerate exactly
 * the documented absent font chunks. The GPU-free launch configuration is
 * settled HERE, empirically: host-side renderer "none" plus --disable-gpu with
 * SwiftShader fallback flags.
 */
import { execSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { chromium } from "playwright";

const distRoot = resolve("dist");
const MIME = new Map([
	[".html", "text/html; charset=utf-8"],
	[".js", "text/javascript"],
	[".mjs", "text/javascript"],
	[".css", "text/css"],
	[".json", "application/json"],
	[".svg", "image/svg+xml"],
	[".avif", "image/avif"],
	[".png", "image/png"],
	[".wasm", "application/wasm"],
	[".map", "application/json"],
]);

const failures = [];
const passed = [];

function check(name, condition, detail) {
	if (condition) {
		passed.push(name);
		console.log(`smoke/assert ${name}: PASS`);
	} else {
		failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
		console.log(`smoke/assert ${name}: FAIL${detail ? ` — ${detail}` : ""}`);
	}
}

function serve() {
	const server = createServer(async (req, res) => {
		try {
			const url = new URL(req.url ?? "/", "http://127.0.0.1");
			let pathname = decodeURIComponent(url.pathname);
			if (pathname === "/") pathname = "/index.html";
			const target = normalize(join(distRoot, pathname));
			if (target !== distRoot && !target.startsWith(distRoot + sep)) {
				throw new Error("path escapes dist");
			}
			const body = await readFile(target);
			res.writeHead(200, {
				"content-type": MIME.get(extname(target)) ?? "application/octet-stream",
			});
			res.end(body);
		} catch {
			res.writeHead(404, { "content-type": "text/plain" });
			res.end("not found");
		}
	});
	return new Promise((resolvePort) => {
		server.listen(0, "127.0.0.1", () => {
			resolvePort({ server, port: server.address().port });
		});
	});
}

async function launchBrowser() {
	const options = {
		headless: true,
		args: [
			"--disable-gpu",
			"--disable-dev-shm-usage",
			// SwiftShader fallback: keeps any incidental WebGL context
			// constructible on a machine with no GPU at all.
			"--use-angle=swiftshader",
			"--enable-unsafe-swiftshader",
		],
	};
	try {
		return await chromium.launch(options);
	} catch (error) {
		const text = String(error);
		if (!/Executable doesn't exist|playwright install/i.test(text)) {
			throw error;
		}
		console.log(
			"smoke: no chromium build cached for this playwright version; installing one",
		);
		execSync("npx playwright install chromium", { stdio: "inherit" });
		return await chromium.launch(options);
	}
}

const { server, port } = await serve();
const browser = await launchBrowser();
const consoleErrors = [];
const pageErrors = [];
const failedResponses = [];
const assetRequests = [];

try {
	const context = await browser.newContext({
		viewport: { width: 1440, height: 900 },
	});
	const page = await context.newPage();
	page.on("console", (message) => {
		if (message.type() === "error") consoleErrors.push(message.text());
	});
	page.on("pageerror", (error) => pageErrors.push(String(error)));
	page.on("response", (response) => {
		if (response.status() >= 400) {
			failedResponses.push(`${response.status()} ${response.url()}`);
		}
	});
	page.on("request", (request) => {
		const url = request.url();
		if (url.includes("font-atlas.json") || url.includes("logo.svg")) {
			assetRequests.push(url);
		}
	});
	await page.addInitScript(() => {
		localStorage.setItem("hasSeenOnboarding", "true");
	});

	await page.goto(`http://127.0.0.1:${port}/`, {
		waitUntil: "domcontentloaded",
		timeout: 60_000,
	});

	// 1. Mount: the Surface root exists, is visible, and fills the host's box —
	//    a surface that collapses to a header strip (the definite-height trap
	//    documented in src/main.tsx) fails here, not just in manual inspection.
	const surface = page.locator(
		'[data-editor-surface]:not([data-editor-surface-portal])',
	);
	await surface.waitFor({ state: "visible", timeout: 120_000 });
	const box = await surface.boundingBox();
	check(
		"mount/surface-root",
		box !== null && box.width > 800 && box.height > 600,
		box ? `box ${Math.round(box.width)}x${Math.round(box.height)}` : "no box",
	);

	// 2. Host chrome: the header renders the host-supplied branding logo.
	const logo = page.locator('img[src*="logo.svg"]');
	await logo.waitFor({ state: "visible", timeout: 60_000 });
	check("mount/branding-logo", true);

	// 3. GPU-free proof: the forced-"none" rasterizer shows the degraded
	//    banner — the editor booted degraded-but-interactive, by design.
	await page
		.getByText("Renderer unavailable in this environment")
		.waitFor({ state: "visible", timeout: 120_000 });
	check("gpu-free/degraded-banner", true);

	// 4. Interaction (real): a plain click inside the surface (the preview
	//    area) moves focus into the surface's focus scope. Deliberately NOT the
	//    ruler — its seek controller preventDefaults mousedown, which suppresses
	//    the focus move; the preview click rides the Surface's own scope.
	const surfaceBox = await surface.boundingBox();
	if (surfaceBox) {
		await page.mouse.click(
			surfaceBox.x + surfaceBox.width / 2,
			surfaceBox.y + surfaceBox.height / 2,
		);
	}
	const focusInside = await page.evaluate(() => {
		const active = document.activeElement;
		const root = document.querySelector(
			'[data-editor-surface]:not([data-editor-surface-portal])',
		);
		return active instanceof HTMLElement && root instanceof HTMLElement
			? root.contains(active)
			: false;
	});
	check("interaction/focus-scope", focusInside === true);

	// 5. Interaction (real, state-changing): a ruler scrub seeks the playhead —
	//    a real mousedown through React's event path with a DOM effect (the
	//    playhead's aria-valuenow / left move). The banner's dismiss button was
	//    the earlier choice, but the preview placeholder overflows its panel in
	//    this GPU-free layout and intercepts its pointer events; the timeline
	//    is the interaction the task names anyway.
	const playhead = page.locator(
		'[role="slider"][aria-label="Timeline playhead"]',
	);
	await playhead.waitFor({ state: "attached", timeout: 30_000 });
	const before = await playhead.evaluate((el) => ({
		now: el.getAttribute("aria-valuenow"),
		left: el.style.left,
	}));
	const ruler = page.locator('[role="slider"][aria-label="Timeline ruler"]');
	await ruler.waitFor({ state: "visible", timeout: 30_000 });
	const rulerBox = await ruler.boundingBox();
	if (rulerBox) {
		await page.mouse.move(
			rulerBox.x + rulerBox.width / 3,
			rulerBox.y + rulerBox.height / 2,
		);
		await page.mouse.down();
		await page.mouse.move(
			rulerBox.x + (rulerBox.width * 2) / 3,
			rulerBox.y + rulerBox.height / 2,
			{ steps: 5 },
		);
		await page.mouse.up();
	}
	await page.waitForTimeout(500);
	const after = await playhead.evaluate((el) => ({
		now: el.getAttribute("aria-valuenow"),
		left: el.style.left,
	}));
	check(
		"interaction/playhead-scrub",
		after.now !== before.now || after.left !== before.left,
		`aria-valuenow ${before.now} -> ${after.now}, left ${before.left} -> ${after.left}`,
	);

	// 6. Committed runtime assets actually served (200 by the failed-response
	//    gate; asserted present so the committed set stays meaningful).
	check(
		"assets/fetched",
		assetRequests.some((url) => url.includes("font-atlas.json")) &&
			assetRequests.some((url) => url.includes("logo.svg")),
		assetRequests.join(", ") || "none requested",
	);

	// 7. Clean run: no unhandled page errors, no console errors and no failed
	//    responses — except the one documented degradation. The font chunks
	//    (`/fonts/font-chunk-<n>.avif`) are deliberately not committed (see
	//    README); the editor falls back to system fonts and each missing chunk
	//    logs exactly one resource-404. Any OTHER console error or failed
	//    response anywhere in the boot fails the gate.
	await page.waitForTimeout(2_000);
	const FONT_CHUNK_404 = /\/fonts\/font-chunk-\d+\.avif$/;
	const fontChunk404s = failedResponses.filter((url) => FONT_CHUNK_404.test(url));
	const resource404Errors = consoleErrors.filter((line) =>
		/^Failed to load resource: the server responded with a status of 404/.test(line),
	);
	const otherConsoleErrors = consoleErrors.filter((line) => !resource404Errors.includes(line));
	check(
		"clean/console",
		otherConsoleErrors.length === 0 && resource404Errors.length === fontChunk404s.length,
		[
			...otherConsoleErrors.slice(0, 5),
			...(resource404Errors.length === fontChunk404s.length
				? []
				: [
						`resource-404 console errors (${resource404Errors.length}) != font-chunk 404 responses (${fontChunk404s.length})`,
					]),
		].join(" | "),
	);
	check("clean/pageerror", pageErrors.length === 0, pageErrors.slice(0, 5).join(" | "));
	check(
		"clean/network",
		failedResponses.length === fontChunk404s.length,
		failedResponses.filter((url) => !FONT_CHUNK_404.test(url)).slice(0, 5).join(" | "),
	);

	await context.close();
} finally {
	await browser.close();
	server.close();
}

if (failures.length > 0) {
	console.error(`embed-surface smoke: FAIL (${failures.length} assertion(s))`);
	for (const failure of failures) console.error(`  - ${failure}`);
	process.exit(1);
}
console.log(
	`embed-surface smoke: PASS (${passed.length} assertions: ${passed.join(", ")})`,
);
process.exit(0);
