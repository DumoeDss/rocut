import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const selected = [
	["--mv-audio", "mv-audio", true],
	["--mv-sprites", "mv-sprite", true],
	["--mv-composition", "mv-composition", true],
	["--mv-post", "mv-post", true],
	["--mv-transitions", "mv-transition", true],
	["--mv-recipe", "mv-recipe", false],
].find(([flag]) => process.argv.includes(flag));
const fixture = `${selected?.[1] ?? "programmatic"}-browser-probe.html`;
// Other sessions can run different fixtures against this checkout. Their
// dependency optimizers must not replace this run's browser module cache.
const cacheDir = await mkdtemp(join(tmpdir(), "rocut-frame-probe-vite-"));
const server = await createServer({
	root,
	cacheDir,
	logLevel: "error",
	configFile: false,
	plugins: [wasm(), topLevelAwait()],
	optimizeDeps: {
		entries: [`script/fixtures/${fixture}`],
	},
	resolve: {
		alias: { "opencut-wasm": join(root, "rust/wasm/pkg/opencut_wasm.js") },
	},
	server: { host: "127.0.0.1", port: 0, strictPort: false },
});
let browser;
try {
	await server.listen();
	const address = server.httpServer.address();
	if (!address || typeof address === "string")
		throw Error("Missing fixture server port");
	browser = await chromium.launch({ headless: true });
	const page = await browser.newPage();
	const errors = [];
	const diagnostics = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("requestfailed", (request) => {
		const url = new URL(request.url());
		diagnostics.push(`${url.pathname}: ${request.failure()?.errorText}`);
	});
	// Any network escape from the source is a failure, never send it to the internet.
	const escapes = [];
	await page.route("**/*", async (route) => {
		const url = new URL(route.request().url());
		if (
			url.hostname !== "127.0.0.1" &&
			["http:", "https:"].includes(url.protocol)
		) {
			escapes.push(url.origin);
			await route.abort();
		} else await route.continue();
	});
	try {
		await page.goto(
			`http://127.0.0.1:${address.port}/script/fixtures/${fixture}`,
			{ waitUntil: "commit" },
		);
		// The fixture owns async module initialization and all render/encode work.
		// Wait for its explicit result, not the unrelated default 30s load budget.
		await page.waitForFunction(() => globalThis.__programmaticResult, null, {
			timeout: 120000,
		});
	} catch (error) {
		console.error(JSON.stringify({ errors, diagnostics }));
		throw error;
	}
	const result = await page.evaluate(() => globalThis.__programmaticResult);
	if (selected?.[2]) {
		const evidence = await mkdtemp(join(tmpdir(), `rocut-${selected[1]}-`));
		const sheet = page.locator(`#${selected[1]}-contact-sheet`);
		if (await sheet.count())
			await sheet.screenshot({ path: join(evidence, "contact-sheet.png") });
		else
			await page.screenshot({
				path: join(evidence, "contact-sheet.png"),
				fullPage: true,
			});
		console.log(
			JSON.stringify({ visualEvidence: join(evidence, "contact-sheet.png") }),
		);
	}
	await expect.poll(() => page.workers().length, { timeout: 2000 }).toBe(0);
	if (result.error || errors.length || escapes.length)
		throw Error(JSON.stringify({ result, errors, escapes }));
	console.log(JSON.stringify(result, null, 2));
} finally {
	await browser?.close();
	await server.close();
}
