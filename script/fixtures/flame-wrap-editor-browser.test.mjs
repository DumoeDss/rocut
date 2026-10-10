import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { chromium } from "../browser-probe-toolchain.mjs";
import { flameWrapEditorInit } from "./flame-wrap-editor-browser.mjs";

test(
	"guarded worker deny rejects registration without opaque iframe getter errors",
	{ timeout: 30000 },
	async () => {
		const server = createServer((_request, response) => {
			response.setHeader("Content-Type", "text/html; charset=utf-8");
			response.end(
				'<iframe sandbox="allow-scripts" srcdoc="<script>window.ready=true</script>"></iframe>',
			);
		});
		await new Promise((done) => server.listen(0, "127.0.0.1", done));
		let browser;
		try {
			browser = await chromium.launch({ headless: true });
			const url = `http://127.0.0.1:${server.address().port}`;
			const legacy = await browser.newContext({ serviceWorkers: "block" });
			const legacyPage = await legacy.newPage();
			const legacyErrors = [];
			legacyPage.on("pageerror", (error) => legacyErrors.push(error));
			await legacyPage.goto(url);
			assert.equal(
				await legacyPage.frames()[1].evaluate(() => window.ready),
				true,
			);
			assert(
				legacyErrors.some(
					(error) =>
						error.name === "SecurityError" &&
						error.message.includes("serviceWorker"),
				),
			);
			await legacy.close();
			const guarded = await browser.newContext({ serviceWorkers: "allow" });
			await guarded.addInitScript(flameWrapEditorInit);
			const page = await guarded.newPage();
			const errors = [];
			page.on("pageerror", (error) => errors.push(error));
			await page.goto(url);
			assert.equal(await page.frames()[1].evaluate(() => window.ready), true);
			assert.deepEqual(errors, []);
			assert.equal(await page.evaluate(() => navigator.gpu), undefined);
			const registration = await page.evaluate(async () => {
				try {
					await navigator.serviceWorker.register("/worker.js");
					return { rejected: false };
				} catch (error) {
					return { rejected: true, message: error.message };
				}
			});
			assert.deepEqual(registration, {
				rejected: true,
				message: "Private editor probe blocks service worker registration",
			});
			assert.equal(
				await page.locator("iframe").getAttribute("sandbox"),
				"allow-scripts",
			);
			assert.equal(
				await page.frames()[1].evaluate(() => {
					try {
						void navigator.serviceWorker;
						return "unexpectedly allowed";
					} catch (error) {
						return error.name;
					}
				}),
				"SecurityError",
			);
			await guarded.close();
		} finally {
			await browser?.close();
			await new Promise((done) => server.close(done));
		}
	},
);
