import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { expect } from "@playwright/test";
import { probeCueRanges } from "./probe-cue-ranges.mjs";
import { probeAudioBinding, probeLocksAndVariations, probeMotionControls } from "./probe-motion-controls.mjs";
import { probeCueStyle, probeCueTaps, probePlanningControls, probeCutBoundary } from "./probe-cue-controls.mjs";

// Mutations use the editor UI; durable API reads provide independent oracles.
export async function probeCoreInteractions({ page, evidence, work, audioFixture, flags, onPhase }) {
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
	// Hover the outer scroll panel, not the textarea whose wrapped lines may
	// consume the wheel first in a narrow real-host pane.
	await page.locator('#motion-text-source').locator('..').hover({position:{x:3,y:3}});
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
	onPhase('motion insertion');
	if (flags.includes("--audio-sync")) {
		await page.getByRole("combobox", { name: "Lyrics format", exact: true }).click();
		await page.getByRole("option", { name: "LRC timestamps", exact: true }).click();
		const beforeInvalid = await page.evaluate(async () => (await (await fetch(new URL("api/record", location.href))).json()).record.data.scenes);
		await page.locator("#motion-text-source").fill("[00:20.00]Outside the 15-second sequence");
		await add.click();
		await expect(page.locator("#motion-text-message")).toBeVisible();
		const rejected = await page.evaluate(async () => (await (await fetch(new URL("api/record", location.href))).json()).record.data);
		assert.equal(rejected.motionTextSequences?.length ?? 0, 0);
		assert.deepEqual(rejected.scenes, beforeInvalid);
		evidence.checks.push({name:"out-of-range LRC rejected without inserting a clip or sequence",pass:true});
		await page.locator("#motion-text-source").fill("[00:01.00]让画面说话\n[00:07.00]让节奏被看见\n[00:12.00]每一句都有动作");
		await page.screenshot({path:join(work,"lrc-input.png")});
	}
	if (await add.count()) {
		await add.click();
		await page.waitForTimeout(600);
		assert(await page.locator('[aria-label="Select Clean caption"]').count() > 0 || (await page.locator('body').innerText()).includes('00:00:15:00'), 'Motion text must enter the timeline');
		evidence.checks.push({ name: "motion text insert", text: (await page.locator('body').innerText()).slice(-2600) });
	}
	await page.screenshot({ path: join(work, "motion.png") });
	await assertMotionPersistence('motion insertion retains sequence and linked clip');
	if (flags.includes("--audio-sync")) {
		const cues = await page.evaluate(async () => (await (await fetch(new URL("api/record", location.href))).json()).record.data.motionTextSequences[0].cues);
		assert.deepEqual(cues.map(c => c.startTime), [120000, 840000, 1440000]);
		assert(cues.every(c => c.timingSource === "lrc"));
		evidence.checks.push({name:"LRC input preserves explicit timestamps through the editor UI",pass:true});
	}
	onPhase('preset application');
	await page.locator('[data-motion-text-preset-card="style:crimson"]').click();
	await page.locator('[data-testid="motion-text-apply-preset"]').click();
	await waitForPersistedStyle('crimson');
	evidence.checks.push({name:'catalog preset application persisted', pass:true});
	await page.screenshot({path:join(work,'preset-applied.png')});
	onPhase('preset undo and redo');
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
	onPhase('cue text editing');
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
	onPhase('rapid history gestures');
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
	if (flags.includes('--motion-controls')) {
		onPhase('motion controls');
		await probeMotionControls(page, evidence);
		await probeLocksAndVariations(page, evidence);
		await probeCueStyle(page, evidence);
		await probeCueTaps(page, evidence);
	}
	if (flags.includes('--planning-controls')) {
		onPhase('motion planning controls');
		await probePlanningControls(page, evidence);
	}
	if (flags.includes('--cut-controls')) {
		onPhase('motion cut controls');
		await probeCutBoundary(page, evidence);
	}
	if (flags.includes('--cue-ranges')) {
		onPhase('cue loop and export range');
		await probeCueRanges(page, evidence);
	}
	await page.getByRole("combobox", { name: "Preview zoom", exact: true }).click({timeout:5000});
	await page.waitForTimeout(200);
	evidence.checks.push({name:'preview menu', menus: await page.locator('[role="menu"],[role="listbox"]').count(), text: await page.locator('[role="menu"],[role="listbox"]').allTextContents()});
	await page.keyboard.press('Escape');
	onPhase('media import');
	await page.locator('[aria-label="Media"]').click();
	await page.locator('input[type="file"]').setInputFiles(resolve('apps/vite-example/tests/fixtures/fixture-video.mp4'));
	await page.waitForTimeout(2000);
	evidence.checks.push({name:"video import", text: (await page.locator('body').innerText()).slice(-3000)});
	const firstAttachments = await page.evaluate(async () => (await fetch(new URL('api/attachments', location.href))).json());
	assert(firstAttachments.length > 0, 'Video import must persist an attachment');
	onPhase('timeline edits');
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
	onPhase('project reload');
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
	if (flags.includes('--motion-controls')) {
		onPhase('audio binding');
		await probeAudioBinding(page, evidence, { sync: flags.includes("--audio-sync") });
	}
	for (const label of ['Sounds','Text','Stickers','Effects','Transitions','Captions','Adjustment','Settings']) {
		await page.locator('[aria-label="Media"]').locator('..').locator(`[aria-label="${label}"]`).click();
		await page.waitForTimeout(150);
		evidence.checks.push({name:`tab ${label}`, text:(await page.locator('body').innerText()).slice(0,650)});
	}
}
