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
	await page.locator('[data-motion-text-preset-card="style:crimson"]').click();
	await page.locator('[data-testid="motion-text-apply-preset"]').click();
	await page.waitForFunction(async () => {
		const payload = await (await fetch(new URL('api/record', location.href))).json();
		return payload.record.data.motionTextSequences?.[0]?.resolvedPlan?.cuts.every(cut => cut.preset.style === 'crimson');
	}, undefined, {timeout:10000});
	evidence.checks.push({name:'catalog preset application persisted', pass:true});
	await page.screenshot({path:join(work,'preset-applied.png')});
	await page.keyboard.press('Control+z');
	await page.waitForFunction(async () => {
		const payload = await (await fetch(new URL('api/record', location.href))).json();
		return payload.record.data.motionTextSequences?.[0]?.resolvedPlan?.cuts.every(cut => cut.preset.style === 'base');
	}, undefined, {timeout:10000});
	await page.keyboard.press('Control+Shift+z');
	await page.waitForFunction(async () => {
		const payload = await (await fetch(new URL('api/record', location.href))).json();
		return payload.record.data.motionTextSequences?.[0]?.resolvedPlan?.cuts.every(cut => cut.preset.style === 'crimson');
	}, undefined, {timeout:10000});
	evidence.checks.push({name:'catalog preset undo and redo persisted', pass:true});
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
	await page.locator('[aria-label="Switch to list view"]').click();
	await page.locator('[aria-label="Add fixture-video.mp4 to timeline"]').click();
	const waitVideoCount = async (count) => page.waitForFunction(async (expected) => {
		const payload = await (await fetch(new URL('api/record', location.href))).json();
		const tracks = payload.record.data.scenes[0].tracks;
		return [tracks.main, ...tracks.overlay, ...tracks.audio].flatMap(t=>t.elements).filter(e=>e.type==='video').length === expected;
	}, count, {timeout:10000});
	await waitVideoCount(1);
	await page.locator('[aria-label="Edit playhead time"]').click();
	await page.locator('[aria-label="Playhead time"]').fill('00:00:02:00');
	await page.locator('[aria-label="Playhead time"]').press('Enter');
	await page.locator('[aria-label="Split element"]').click();
	await waitVideoCount(2);
	await page.locator('[aria-label="Duplicate element"]').click();
	await waitVideoCount(3);
	await page.locator('[aria-label="Delete element"]').click();
	await waitVideoCount(2);
	evidence.checks.push({name:'list-mode add, seek, split, duplicate, delete persisted',pass:true});
	await page.screenshot({ path: join(work, "media.png") });
	await page.reload({waitUntil:'domcontentloaded'});
	await page.locator('[aria-label="Media"]').waitFor({timeout:30000});
	const restoredStyle = await page.evaluate(async () => {
		const payload = await (await fetch(new URL('api/record', location.href))).json();
		return payload.record.data.motionTextSequences?.[0]?.resolvedPlan?.cuts.every(cut => cut.preset.style === 'crimson');
	});
	assert(restoredStyle, 'Applied JIZURA preset must survive reload');
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
	await page.close();
	const parent = await browser.newPage({viewport:{width:1200,height:800}});
	await parent.setContent('<style>body{margin:0}iframe{width:100vw;height:100vh;border:0}</style><iframe title="Embedded editor"></iframe>');
	await parent.evaluate(url => {
		const frame = document.querySelector('iframe');
		addEventListener('message', event => {
			if (event.source === frame.contentWindow && event.data?.type === 'elftia:request-tool-host-theme') {
				frame.contentWindow.postMessage({type:'elftia:tool-host-theme',version:1,theme:'dark'},new URL(url).origin);
			}
		});
		frame.src = url;
	}, editorUrl);
	const embedded = await parent.locator('iframe').elementHandle().then(handle=>handle.contentFrame());
	await embedded.locator('[aria-label="Media"]').waitFor({timeout:30000});
	await embedded.waitForFunction(()=>document.documentElement.classList.contains('dark'));
	await embedded.evaluate(()=>postMessage({type:'elftia:tool-host-theme',version:1,theme:'light'},'*'));
	await parent.waitForTimeout(100);
	assert(await embedded.evaluate(()=>document.documentElement.classList.contains('dark')), 'Messages not sent by the parent must be ignored');
	await parent.waitForTimeout(2000);
	await parent.screenshot({path:join(work,'embedded-dark.png')});
	await embedded.locator('[aria-label="Play preview"]').click();
	await embedded.waitForFunction(()=>document.querySelector('[aria-label="Edit playhead time"]')?.textContent !== '00:00:00:00');
	await embedded.locator('[aria-label="Pause preview"]').click();
	await parent.screenshot({path:join(work,'embedded-playback.png')});
	evidence.checks.push({name:'embedded playback advances and pauses after project reload',pass:true});
	await parent.evaluate(url=>document.querySelector('iframe').contentWindow.postMessage({type:'elftia:tool-host-theme',version:1,theme:'light'},new URL(url).origin),editorUrl);
	await embedded.waitForFunction(()=>document.documentElement.classList.contains('light'));
	evidence.checks.push({name:'embedded theme handshake, source guard, live light/dark update',pass:true});
	console.log(JSON.stringify(evidence, null, 2));
	console.log(`Evidence: ${work}`);
} finally {
	writeFileSync(join(work, "evidence.json"), JSON.stringify(evidence, null, 2));
	await browser?.close();
	host.kill();
}
