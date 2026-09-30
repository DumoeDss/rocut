#!/usr/bin/env node
// Run against a built plugin without touching the user's installed plugin/project.
// node script/probe-embedded-chrome.mjs <plugin-root>
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";

assert(process.argv[2], "Pass the built plugin root");
const plugin = resolve(process.argv[2]);
const work = mkdtempSync(join(tmpdir(), "rocut-embedded-chrome-"));
const project = join(work, "project");
mkdirSync(project);
const host = spawn(process.execPath, [
	join(plugin, "vendor/run/rocut.mjs"), "host", "start", project,
	"--static", join(plugin, "vendor/surface"), "--port", "0",
], {
	windowsHide: true,
	stdio: ["ignore", "pipe", "pipe"],
	env: { ...process.env, ROCUT_TARGETS_ROOT: join(work, "targets") },
});
// Consume output privately: editorUrl contains an authentication token.
host.stderr.resume();
let browser;
try {
	const editorUrl = await new Promise((accept, reject) => {
		let output = "";
		const timer = setTimeout(() => reject(new Error("Host startup timed out")), 30_000);
		host.once("error", (error) => { clearTimeout(timer); reject(error); });
		host.once("exit", (code) => {
			clearTimeout(timer);
			reject(new Error(`Host exited (${code})`));
		});
		host.stdout.on("data", (chunk) => {
			output += chunk.toString();
			const match = output.match(/^editorUrl (.+)\r?$/m);
			if (match) { clearTimeout(timer); accept(match[1].trim()); }
		});
	});
	browser = await chromium.launch({
		headless: true,
		args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
	});
	const page = await browser.newPage();
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.name));
	await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
	await page.getByRole("button", { name: "Motion text", exact: true })
		.waitFor({ timeout: 60_000 });
	for (const viewport of [{ width: 1440, height: 900 }, { width: 800, height: 650 }]) {
		await page.setViewportSize(viewport);
		await page.locator('[data-host-embedded="true"]').waitFor();
		assert.equal(await page.locator("[data-editor-header]").isVisible(), false);
		assert.equal(await page.getByRole("button", { name: "Export", exact: true }).count(), 0);
		assert.equal(await page.getByRole("button", { name: /^(Light|Dark)$/ }).count(), 0);
		assert.equal(await page.getByText("Host chrome", { exact: false }).count(), 0);
		const layout = await page.locator("#editor-container").evaluate((element) => {
			const box = element.getBoundingClientRect();
			const style = getComputedStyle(element);
			return { x: box.x, y: box.y, width: box.width, height: box.height,
				padding: style.padding, border: style.borderWidth,
				overflowX: document.documentElement.scrollWidth > innerWidth,
				overflowY: document.documentElement.scrollHeight > innerHeight };
		});
		assert.deepEqual(layout, { x: 0, y: 0, ...viewport,
			padding: "0px", border: "0px", overflowX: false, overflowY: false });
		await page.getByRole("button", { name: "Motion text", exact: true }).click();
		await page.screenshot({ path: join(work, `embedded-${viewport.width}.png`) });
	}
	// The same build still provides the bounded demo when it is not host-served.
	await page.route("**/api/context", (route) => route.fulfill({ status: 404, body: "" }));
	await page.reload({ waitUntil: "domcontentloaded" });
	await page.getByText("Host chrome", { exact: false }).waitFor();
	assert.equal(await page.locator("[data-host-embedded]").count(), 0);
	assert.deepEqual(errors, []);
	console.log(`PASS: embedded chrome, two viewport sizes, editor tab interaction, standalone isolation. Screenshots: ${work}`);
} finally {
	await browser?.close();
	host.kill();
}
