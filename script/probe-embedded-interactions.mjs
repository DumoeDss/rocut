import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { probeAudioBinding, probeLocksAndVariations, probeMotionControls } from "./probe-motion-controls.mjs";
import { probeMixedExport } from "./probe-mixed-export.mjs";
import { probeResponsiveMotion } from "./probe-responsive-motion.mjs";
import { probeCueStyle, probeCueTaps, probePlanningControls, probeCutBoundary } from "./probe-cue-controls.mjs";
import { probeJizuraImport } from "./probe-jizura-import.mjs";

// Isolated behavioral regression. Real Elftia acceptance is a separate CLI run.
assert(process.argv[2], "Pass the built/installed plugin root");
const plugin = resolve(process.argv[2]);
const surfaceArg = process.argv[3];
const surface = resolve(surfaceArg && !surfaceArg.startsWith('--') ? surfaceArg : join(plugin, "vendor/surface"));
assert(existsSync(join(surface, 'index.html')), 'Pass an existing built editor surface directory');
const work = mkdtempSync(join(tmpdir(), "rocut-interactions-"));
const project = join(work, "project");
mkdirSync(project);
const audioFixture = process.argv.includes('--motion-controls')
	? join(work, 'fixture-tone-a4.wav')
	: resolve('apps/vite-example/tests/fixtures/fixture-tone-a4.wav');
if (process.argv.includes('--motion-controls')) {
	// Audio binding requires source coverage for the full 15-second sequence.
	execFileSync('ffmpeg', ['-v','error','-n','-f','lavfi','-i','sine=frequency=440:duration=16','-ar','44100','-ac','1','-c:a','pcm_s16le',audioFixture], {windowsHide:true});
}
const host = spawn(process.execPath, [join(plugin, "vendor/run/rocut.mjs"),
	"host", "start", project, "--static", surface, "--port", "0"], {
	windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
	env: { ...process.env, ROCUT_TARGETS_ROOT: join(work, "targets") },
});
host.stderr.resume();
let browser;
let parentServer;
const evidence = { checks: [], errors: [], requests: [], writes: [] };
const pendingResponseDetails = [];
let phase = 'startup';
const scrub = (value) => String(value).replace(/(https?:\/\/(?:127\.0\.0\.1|localhost):\d+)\/[^\s/]+/g, "$1/[redacted]");
const observeResponse = response => {
	const request = response.request();
	if (response.status() >= 400) evidence.requests.push({url:scrub(response.url()),status:response.status(),method:request.method(),phase});
	if (request.method() !== 'PUT' || !new URL(response.url()).pathname.endsWith('/api/record')) return;
	const data = request.postDataJSON()?.record?.data;
	const envelope = data?.__opencutTransaction;
	const summary = {phase,status:response.status(),revision:envelope?.revision,historyCount:envelope?.idempotency?.length,sequences:data?.motionTextSequences?.length};
	evidence.writes.push(summary);
	if (response.status() === 409) pendingResponseDetails.push(response.json().then(body => {
		summary.responseKeys = Object.keys(body);
		summary.error = body.error;
		summary.name = body.name;
		summary.message = body.message ? scrub(body.message) : undefined;
		summary.storedRevision = body.storedRevision;
		summary.incomingRevision = body.incomingRevision;
	}).catch(error=>{ summary.detailReadError = scrub(error.message); }));
};
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
	page.on("response", observeResponse);
	await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
	const waitForPersistedStyle = async style => {
		await expect.poll(() => page.evaluate(async expected => {
			const {record} = await (await fetch(new URL('api/record',location.href))).json();
			const cuts = record.data.motionTextSequences?.[0]?.resolvedPlan?.cuts ?? [];
			return cuts.length > 0 && cuts.every(cut=>cut.preset.style===expected);
		},style),{timeout:10000,message:`Durable preset style must become ${style}`}).toBe(true);
	};
	const assertMotionPersistence = async (name) => {
		const state = await page.evaluate(async () => {
			const {record} = await (await fetch(new URL('api/record',location.href))).json();
			const data = record.data;
			const sequences = data.motionTextSequences ?? [];
			const clips = data.scenes.flatMap(scene => [scene.tracks.main,...scene.tracks.overlay,...scene.tracks.audio].flatMap(track=>track.elements)).filter(element=>element.type==='motion-text');
			return {sequences:sequences.length, clips:clips.length, linked:clips.every(clip=>sequences.some(sequence=>sequence.id===clip.sequenceId && sequence.resolvedPlan.cuts.length>0))};
		});
		evidence.checks.push({name,...state});
		assert.equal(state.sequences,1, 'The inserted motion-text sequence must remain in the durable project');
		assert.equal(state.clips,1, 'The inserted motion-text clip must remain in the durable timeline');
		assert(state.linked, 'Every motion-text clip must reference a persisted nonempty sequence');
	};
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
	phase = 'motion insertion';
	if (await add.count()) {
		await add.click();
		await page.waitForTimeout(600);
		assert(await page.locator('[aria-label="Select Clean caption"]').count() > 0 || (await page.locator('body').innerText()).includes('00:00:15:00'), 'Motion text must enter the timeline');
		evidence.checks.push({ name: "motion text insert", text: (await page.locator('body').innerText()).slice(-2600) });
	}
	await page.screenshot({ path: join(work, "motion.png") });
	await assertMotionPersistence('motion insertion retains sequence and linked clip');
	phase = 'preset application';
	await page.locator('[data-motion-text-preset-card="style:crimson"]').click();
	await page.locator('[data-testid="motion-text-apply-preset"]').click();
	await waitForPersistedStyle('crimson');
	evidence.checks.push({name:'catalog preset application persisted', pass:true});
	await page.screenshot({path:join(work,'preset-applied.png')});
	phase = 'preset undo and redo';
	evidence.checks.push({name:'focus before undo',...await page.evaluate(() => {
		const active = document.activeElement;
		window.__probeKeys = [];
		document.addEventListener('keydown', event => {
			const item = {key:event.key,ctrl:event.ctrlKey,tag:event.target?.tagName,testid:event.target?.getAttribute?.('data-testid'),insideSurface:!!event.target?.closest?.('[data-editor-surface]')};
			window.__probeKeys.push(item);
			queueMicrotask(()=>{item.prevented=event.defaultPrevented;});
		},true);
		return {tag:active?.tagName,testid:active?.getAttribute('data-testid'),insideSurface:!!active?.closest('[data-editor-surface]')};
	})});
	assert.equal(evidence.checks.at(-1).testid, 'motion-text-apply-preset', 'Applying a preset must retain button focus for subsequent editor shortcuts');
	await page.keyboard.press('Control+z');
	evidence.checks.push({name:'undo key dispatch',events:await page.evaluate(()=>window.__probeKeys)});
	await waitForPersistedStyle('base');
	await page.keyboard.press('Control+Shift+z');
	evidence.checks.push({name:'redo key dispatch',...await page.evaluate(()=>({tag:document.activeElement?.tagName,insideSurface:!!document.activeElement?.closest('[data-editor-surface]'),events:window.__probeKeys}))});
	await waitForPersistedStyle('crimson');
	evidence.checks.push({name:'catalog preset undo and redo persisted', pass:true});
	await assertMotionPersistence('undo and redo retain sequence and linked clip');
	phase = 'cue text editing';
	const cueRows = page.locator('[aria-labelledby="motion-text-cues-heading"] button[aria-expanded]');
	await cueRows.first().click();
	const cueInput = page.locator('textarea[id^="motion-text-cue-"]');
	const originalCueText = await cueInput.inputValue();
	const editedCueText = '歌词编辑回归 · Cue edit';
	const waitForCueText = async expected => expect.poll(() => page.evaluate(async () => {
		const {record} = await (await fetch(new URL('api/record',location.href))).json();
		return record.data.motionTextSequences?.[0]?.cues?.[0]?.text;
	}),{timeout:10000,message:`Durable first cue text must become ${expected}`}).toBe(expected);
	await cueInput.fill(editedCueText);
	await cueInput.press('Control+Enter');
	await waitForCueText(editedCueText);
	await expect(cueInput).toHaveCount(0);
	evidence.checks.push({name:'focus after cue editor closes',...await page.evaluate(() => ({tag:document.activeElement?.tagName,insideSurface:!!document.activeElement?.closest('[data-editor-surface]')}))});
	await page.keyboard.press('Control+z');
	await waitForCueText(originalCueText);
	await page.keyboard.press('Control+Shift+z');
	await waitForCueText(editedCueText);
	await page.keyboard.press('Control+z');
	await waitForCueText(originalCueText);
	evidence.checks.push({name:'cue text keyboard apply, close, undo and redo persist',pass:true});
	phase = 'rapid history gestures';
	const beforeBurst = await page.evaluate(async () => {
		const {record} = await (await fetch(new URL('api/record',location.href))).json();
		return record.data.__opencutTransaction.revision;
	});
	for (let i=0;i<3;i++) {
		await page.keyboard.press('Control+Shift+z');
		await page.keyboard.press('Control+z');
	}
	await expect.poll(() => page.evaluate(async () => {
		const {record} = await (await fetch(new URL('api/record',location.href))).json();
		return record.data.__opencutTransaction.revision;
	}),{timeout:10000,message:'Every rapid undo/redo gesture must commit'}).toBe(beforeBurst + 6);
	await waitForCueText(originalCueText);
	evidence.checks.push({name:'six rapid undo/redo gestures commit in order without dropped actions',pass:true});
	if (process.argv.includes('--motion-controls')) {
		phase = 'motion controls';
		await probeMotionControls(page, evidence);
		await probeLocksAndVariations(page, evidence);
		await probeCueStyle(page, evidence);
		await probeCueTaps(page, evidence);
	}
	if (process.argv.includes('--planning-controls')) {
		phase = 'motion planning controls';
		await probePlanningControls(page, evidence);
	}
	if (process.argv.includes('--cut-controls')) {
		phase = 'motion cut controls';
		await probeCutBoundary(page, evidence);
	}
	await page.locator('[role="combobox"]').first().click({timeout:5000});
	await page.waitForTimeout(200);
	evidence.checks.push({name:'preview menu', menus: await page.locator('[role="menu"],[role="listbox"]').count(), text: await page.locator('[role="menu"],[role="listbox"]').allTextContents()});
	await page.keyboard.press('Escape');
	phase = 'media import';
	await page.locator('[aria-label="Media"]').click();
	await page.locator('input[type="file"]').setInputFiles(resolve('apps/vite-example/tests/fixtures/fixture-video.mp4'));
	await page.waitForTimeout(2000);
	evidence.checks.push({name:"video import", text: (await page.locator('body').innerText()).slice(-3000)});
	const firstAttachments = await page.evaluate(async () => (await fetch(new URL('api/attachments', location.href))).json());
	assert(firstAttachments.length > 0, 'Video import must persist an attachment');
	phase = 'timeline edits';
	await page.locator('[aria-label="Switch to list view"]').click();
	await page.locator('[aria-label="Add fixture-video.mp4 to timeline"]').click();
	const waitVideoCount = async count => expect.poll(() => page.evaluate(async () => {
		const payload = await (await fetch(new URL('api/record', location.href))).json();
		const tracks = payload.record.data.scenes[0].tracks;
		return [tracks.main, ...tracks.overlay, ...tracks.audio].flatMap(t=>t.elements).filter(e=>e.type==='video').length;
	}),{timeout:10000,message:`Durable video count must become ${count}`}).toBe(count);
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
	await assertMotionPersistence('media edits retain motion sequence and linked clip');
	await page.screenshot({ path: join(work, "media.png") });
	phase = 'project reload';
	await page.reload({waitUntil:'domcontentloaded'});
	await page.locator('[aria-label="Media"]').waitFor({timeout:30000});
	const restoredStyle = await page.evaluate(async () => {
		const payload = await (await fetch(new URL('api/record', location.href))).json();
		return payload.record.data.motionTextSequences?.[0]?.resolvedPlan?.cuts.every(cut => cut.preset.style === 'crimson');
	});
	assert(restoredStyle, 'Applied JIZURA preset must survive reload');
	await assertMotionPersistence('reload retains motion sequence and linked clip');
	await page.locator('[aria-label="Media"]').click();
	await page.locator('input[type="file"]').setInputFiles(audioFixture);
	await page.waitForTimeout(1500);
	const secondAttachments = await page.evaluate(async () => (await fetch(new URL('api/attachments', location.href))).json());
	evidence.checks.push({name:'reload then import audio', before:firstAttachments.length,after:secondAttachments.length});
	assert(secondAttachments.length > firstAttachments.length, 'Importing after reload must not overwrite existing media');
	await page.locator('input[type="file"]').setInputFiles({name:'broken-probe.mp4',mimeType:'video/mp4',buffer:Buffer.from('not a media container')});
	await page.locator('[data-sonner-toast]').filter({hasText:'Failed to process broken-probe.mp4'}).waitFor({timeout:10000});
	await page.locator('[data-sonner-toast]').filter({hasText:'No media assets were uploaded'}).waitFor({timeout:10000});
	const afterCorrupt = await page.evaluate(async () => (await fetch(new URL('api/attachments', location.href))).json());
	assert.equal(afterCorrupt.length, secondAttachments.length, 'Corrupt video must not persist an attachment');
	evidence.checks.push({name:'corrupt video rejected without persisting an attachment',pass:true});
	if (process.argv.includes('--motion-controls')) {
		phase = 'audio binding';
		await probeAudioBinding(page, evidence);
	}
	for (const label of ['Sounds','Text','Stickers','Effects','Transitions','Captions','Adjustment','Settings']) {
		await page.locator('[aria-label="Media"]').locator('..').locator(`[aria-label="${label}"]`).click();
		await page.waitForTimeout(150);
		evidence.checks.push({name:`tab ${label}`, text:(await page.locator('body').innerText()).slice(0,650)});
	}
	await page.close();
	phase = 'secure embedded reload';
	const parent = await browser.newPage({viewport:{width:1200,height:800}});
	parent.on('pageerror', error => evidence.errors.push(scrub(error.message)));
	parent.on('console', message => { if (message.type() === 'error') evidence.errors.push(scrub(message.text())); });
	parent.on('response', observeResponse);
	parent.on('requestfailed', request => evidence.errors.push(scrub(`${request.url()}: ${request.failure()?.errorText}`)));
	// about:blank is an insecure ancestor and disables WebCodecs in the child.
	// Model Elftia's secure localhost origin while keeping the iframe cross-origin.
	// Use an actual loopback listener: intercepted synthetic documents can be
	// classified as public-network pages by Chromium's local-network checks.
	parentServer = createServer((_request, response) => {
		response.writeHead(200, {'Content-Type':'text/html'});
		response.end('<style>body{margin:0}iframe{width:100vw;height:100vh;border:0}</style><iframe title="Embedded editor" referrerpolicy="no-referrer"></iframe>');
	});
	await new Promise((resolve, reject) => { parentServer.once('error', reject); parentServer.listen(0, '127.0.0.1', resolve); });
	await parent.goto(`http://127.0.0.1:${parentServer.address().port}/`);
	await parent.evaluate(url => {
		const frame = document.querySelector('iframe');
		addEventListener('message', event => {
			if (event.source === frame.contentWindow && event.data?.type === 'elftia:request-tool-host-theme') {
				frame.contentWindow.postMessage({type:'elftia:tool-host-theme',version:1,theme:'dark'},new URL(url).origin);
			}
		});
		frame.src = url;
	}, editorUrl);
	await parent.frameLocator('iframe').locator('[aria-label="Media"]').waitFor({timeout:30000}).catch(async error => {
		await parent.screenshot({path:join(work,'embedded-load-failure.png')});
		for (const frame of parent.frames()) evidence.checks.push({name:'frame load failure',url:scrub(frame.url()),text:await frame.locator('body').innerText().catch(()=>'<unavailable>')});
		throw error;
	});
	const embedded = await parent.locator('iframe').elementHandle().then(handle=>handle.contentFrame());
	assert(await embedded.evaluate(() => isSecureContext && typeof VideoDecoder !== 'undefined'), 'Embedded editor must have the same secure WebCodecs context as Elftia');
	await embedded.waitForFunction(()=>document.documentElement.classList.contains('dark'));
	await embedded.evaluate(()=>postMessage({type:'elftia:tool-host-theme',version:1,theme:'light'},'*'));
	await parent.waitForTimeout(100);
	assert(await embedded.evaluate(()=>document.documentElement.classList.contains('dark')), 'Messages not sent by the parent must be ignored');
	await parent.waitForTimeout(2000);
	evidence.checks.push({name:'embedded rendering diagnostics', ...await embedded.evaluate(() => ({secure:isSecureContext, gpu:!!navigator.gpu, canvases:Array.from(document.querySelectorAll('canvas')).map(c=>({width:c.width,height:c.height,rect:{width:c.getBoundingClientRect().width,height:c.getBoundingClientRect().height}}))}))});
	await parent.screenshot({path:join(work,'embedded-dark.png')});
	const assertPreviewPixels = async (name) => {
		const png = await embedded.locator('canvas').first().screenshot({path:join(work,`${name}.png`)});
		const pixels = await parent.evaluate(async bytes => {
			const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/png'}));
			const canvas = new OffscreenCanvas(bitmap.width,bitmap.height);
			const ctx = canvas.getContext('2d');
			ctx.drawImage(bitmap,0,0);
			const {data} = ctx.getImageData(0,0,bitmap.width,bitmap.height);
			let red = 0, light = 0;
			for (let i=0;i<data.length;i+=4) {
				if (data[i]>160 && data[i+1]<130 && data[i+2]<130) red++;
				if (data[i]>200 && data[i+1]>200 && data[i+2]>200) light++;
			}
			bitmap.close();
			return {redFraction:red/(data.length/4),lightFraction:light/(data.length/4)};
		},Array.from(png));
		assert(pixels.redFraction > 0.25, 'Preview must visibly render the red video fixture, not just advance its clock');
		evidence.checks.push({name,...pixels,pass:true});
		return pixels;
	};
	await assertPreviewPixels('embedded-first-frame');
	await embedded.locator('[aria-label="Play preview"]').click();
	await embedded.waitForFunction(()=>document.querySelector('[aria-label="Edit playhead time"]')?.textContent !== '00:00:00:00');
	await embedded.locator('[aria-label="Pause preview"]').click();
	await embedded.locator('[aria-label="Edit playhead time"]').click();
	await embedded.locator('[aria-label="Playhead time"]').fill('00:00:02:00');
	await embedded.locator('[aria-label="Playhead time"]').press('Enter');
	await parent.waitForTimeout(500);
	await parent.screenshot({path:join(work,'embedded-playback.png')});
	const mixedFrame = await assertPreviewPixels('embedded-playback-frame');
	assert(mixedFrame.lightFraction > 0.001, 'The mixed timeline must visibly render the white motion-text glyphs over the video at two seconds');
	evidence.checks.push({name:'embedded playback advances and pauses after project reload',pass:true});
	await parent.evaluate(url=>document.querySelector('iframe').contentWindow.postMessage({type:'elftia:tool-host-theme',version:1,theme:'light'},new URL(url).origin),editorUrl);
	await embedded.waitForFunction(()=>document.documentElement.classList.contains('light'));
	evidence.checks.push({name:'embedded theme handshake, source guard, live light/dark update',pass:true});
	if (process.argv.includes('--mixed-export')) {
		assert(process.argv.includes('--motion-controls'), 'Mixed export requires the audio timeline fixture');
		phase = 'mixed ranged export';
		await probeMixedExport(embedded, project, evidence);
	}
	if (process.argv.includes('--responsive')) {
		phase = 'responsive motion controls';
		await probeResponsiveMotion(parent, embedded, work, evidence);
	}
	if (process.argv.includes('--stress-store')) {
		phase = 'isolated atomic save stress';
		const stress = await embedded.evaluate(async () => {
			const url = new URL('api/record',location.href);
			let reading = true;
			const reader = (async () => { while (reading) await (await fetch(url)).arrayBuffer(); })();
			let saves = 0;
			let failure;
			try {
				for (let i=0;i<100;i++) {
					const snapshot = await (await fetch(url)).json();
					const response = await fetch(url,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(snapshot)});
					if (!response.ok) { failure = {status:response.status(),body:await response.json()}; break; }
					saves++;
				}
			} finally { reading = false; await reader; }
			return {saves,failure};
		});
		evidence.checks.push({name:'isolated atomic save stress',...JSON.parse(scrub(JSON.stringify(stress)))});
		assert.equal(stress.saves,100,'Atomic project saves must tolerate concurrent readers');
	}
	if (process.argv.includes('--jizura-import')) {
		phase = 'JIZURA file import';
		await probeJizuraImport(parent, embedded, evidence);
	}
	assert(!evidence.errors.some(error => /Failed to render preview frame|Failed to initialize video sink/.test(error)), 'Preview must not report rendering or decoding failures');
	assert.deepEqual(evidence.requests.filter(request => !(request.status === 404 && request.url.includes('/api/library/'))), [], 'Unexpected HTTP failures, including save conflicts, must fail acceptance');
} finally {
	await Promise.all(pendingResponseDetails);
	writeFileSync(join(work, "evidence.json"), JSON.stringify(evidence, null, 2));
	console.log(JSON.stringify(evidence, null, 2));
	console.log(`Evidence: ${work}`);
	await browser?.close();
	if (parentServer) await new Promise(resolve => parentServer.close(resolve));
	host.kill();
}
