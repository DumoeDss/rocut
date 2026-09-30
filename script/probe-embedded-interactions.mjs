import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";

// Isolated behavioral regression. Real Elftia acceptance is a separate CLI run.
assert(process.argv[2], "Pass the built/installed plugin root");
const plugin = resolve(process.argv[2]);
const surface = resolve(process.argv[3] ?? join(plugin, "vendor/surface"));
const work = mkdtempSync(join(tmpdir(), "rocut-interactions-"));
const project = join(work, "project");
mkdirSync(project);
const host = spawn(process.execPath, [join(plugin, "vendor/run/rocut.mjs"),
	"host", "start", project, "--static", surface, "--port", "0"], {
	windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
	env: { ...process.env, ROCUT_TARGETS_ROOT: join(work, "targets") },
});
host.stderr.resume();
let browser;
const evidence = { checks: [], errors: [], requests: [] };
const scrub = (value) => String(value).replace(/(https?:\/\/(?:127\.0\.0\.1|localhost):\d+)\/[^\s/]+/g, "$1/[redacted]");
try {
	const editorUrl = await new Promise((accept, reject) => {
		let output = "";
		const timer = setTimeout(() => reject(new Error("Host startup timeout")), 30000);
		host.once("error", reject);
		host.once("exit", code => { clearTimeout(timer); reject(new Error(`Host exited: ${code}`)); });
		host.stdout.on("data", chunk => {
			output += chunk;
			const match = output.match(/^editorUrl (.+)\r?$/m);
			if (match) { clearTimeout(timer); accept(match[1].trim()); }
		});
	});
	browser = await chromium.launch({ headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
	const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
	page.on("pageerror", e => evidence.errors.push(scrub(e.message)));
	page.on("console", m => { if (m.type() === "error") evidence.errors.push(scrub(m.text())); });
	page.on("response", r => { if (r.status() >= 400) evidence.requests.push({url:scrub(r.url()),status:r.status()}); });
	await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
	await page.locator('[aria-label="Motion text"]').waitFor({ timeout: 60000 });
	await page.locator('[aria-label="Motion text"]').click();
	await page.locator('#motion-text-source').hover();
	await page.mouse.wheel(0, 500);
	await page.waitForTimeout(350);
	const scroll = await page.locator('#motion-text-source').evaluate(el => {
		for (let p = el.parentElement; p; p = p.parentElement) {
			if (getComputedStyle(p).overflowY === 'auto') return p.scrollTop;
		}
		return -1;
	});
	evidence.checks.push({ name: "native motion panel wheel", pass: scroll > 0, scroll });
	assert(scroll > 0, "Motion text must scroll with the mouse wheel");
	const add = page.locator('[data-testid="motion-text-add"]');
	if (await add.count()) {
		await add.click();
		await page.waitForTimeout(600);
		assert(await page.locator('[aria-label="Select Clean caption"]').count() > 0 || (await page.locator('body').innerText()).includes('00:00:15:00'), 'Motion text must enter the timeline');
		evidence.checks.push({ name: "motion text insert", text: (await page.locator('body').innerText()).slice(-2600) });
	}
	await page.screenshot({ path: join(work, "motion.png") });
	await page.locator('[role="combobox"]').first().click({timeout:5000});
	await page.waitForTimeout(200);
	evidence.checks.push({name:'preview menu', menus: await page.locator('[role="menu"],[role="listbox"]').count(), text: await page.locator('[role="menu"],[role="listbox"]').allTextContents()});
	await page.keyboard.press('Escape');
	await page.locator('[aria-label="Media"]').click();
	await page.locator('input[type="file"]').setInputFiles(resolve('apps/vite-example/tests/fixtures/fixture-video.mp4'));
	await page.waitForTimeout(2000);
	evidence.checks.push({name:"video import", text: (await page.locator('body').innerText()).slice(-3000)});
	const firstAttachments = await page.evaluate(async () => (await fetch(new URL('api/attachments', location.href))).json());
	assert(firstAttachments.length > 0, 'Video import must persist an attachment');
	await page.screenshot({ path: join(work, "media.png") });
	await page.reload({waitUntil:'domcontentloaded'});
	await page.locator('[aria-label="Media"]').waitFor({timeout:30000});
	await page.locator('[aria-label="Media"]').click();
	await page.locator('input[type="file"]').setInputFiles(resolve('apps/vite-example/tests/fixtures/fixture-tone-a4.wav'));
	await page.waitForTimeout(1500);
	const secondAttachments = await page.evaluate(async () => (await fetch(new URL('api/attachments', location.href))).json());
	evidence.checks.push({name:'reload then import audio', before:firstAttachments.length,after:secondAttachments.length});
	assert(secondAttachments.length > firstAttachments.length, 'Importing after reload must not overwrite existing media');
	for (const label of ['Sounds','Text','Stickers','Effects','Transitions','Captions','Adjustment','Settings']) {
		await page.locator(`[aria-label="${label}"]`).click();
		await page.waitForTimeout(150);
		evidence.checks.push({name:`tab ${label}`, text:(await page.locator('body').innerText()).slice(0,650)});
	}
	console.log(JSON.stringify(evidence, null, 2));
	console.log(`Evidence: ${work}`);
} finally {
	writeFileSync(join(work, "evidence.json"), JSON.stringify(evidence, null, 2));
	await browser?.close();
	host.kill();
}
