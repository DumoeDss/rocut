import assert from "node:assert/strict";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { createScreencastCapture } from "./probe-preview-screencast.mjs";

// Time trusted Apply gestures through durable publication to an exact visible
// compositor picture. Never time an HTTP-only edit or a hidden renderer call.
export async function probePreviewMutation({
	page,
	hostPage,
	work,
	evidence,
	onPhase,
}) {
	const read = () =>
		page.evaluate(
			async () =>
				(await (await fetch(new URL("api/record", location.href))).json())
					.record.data,
		);
	const initial = await read();
	const sequence = initial.motionTextSequences[0];
	assert.equal(sequence.cues.length, 120);
	assert.equal(sequence.duration, 180 * 120000);
	assert.equal(initial.scenes[0].tracks.main.elements[0].type, "video");
	const cueIndex = 60;
	const cue = sequence.cues[cueIndex];
	const clip = initial.scenes[0].tracks.overlay
		.flatMap((t) => t.elements)
		.find((c) => c.type === "motion-text");
	assert(clip);
	await page
		.locator(`[data-testid="timeline-clip"][data-element-id="${clip.id}"]`)
		.click();
	await page.getByLabel("Edit playhead time", { exact: true }).click();
	await page.getByLabel("Playhead time", { exact: true }).fill("00:01:30:06");
	await page.getByLabel("Playhead time", { exact: true }).press("Enter");
	const rows = page.locator(
		'[aria-labelledby="motion-text-cues-heading"] button[aria-expanded]',
	);
	const textarea = page.getByRole("textbox", {
		name: "Lyric text",
		exact: true,
	});
	const open = async (text) => {
		if (!(await textarea.isVisible())) await rows.nth(cueIndex).click();
		await textarea.fill(text);
		const apply = textarea
			.locator("..")
			.locator("..")
			.getByRole("button", { name: "Apply changes", exact: true });
		await apply.evaluate((button) => {
			button.dataset.mutationProbe = "apply";
		});
		// Opening a cue intentionally seeks its start (the fade is transparent
		// there). Measure an interior frame, after this ordinary UI navigation.
		await page.getByLabel("Edit playhead time", { exact: true }).click();
		await page.getByLabel("Playhead time", { exact: true }).fill("00:01:30:06");
		await page.getByLabel("Playhead time", { exact: true }).press("Enter");
		return apply;
	};
	await open("ALPHA ALPHA");
	const { width, height } = initial.settings.canvasSize;
	const canvas = page.locator(`canvas[width="${width}"][height="${height}"]`);
	await expect(canvas).toHaveCount(1);
	const displayed = await canvas.boundingBox();
	assert(displayed && displayed.width > 100 && displayed.height > 50);
	const cdp = await hostPage.context().newCDPSession(hostPage);
	let observer;
	const references = [],
		samples = [];
	evidence.previewMutation = {
		fixture: "F04",
		cueId: cue.id,
		cueIndex,
		samples,
		references,
		lastAttempt: null,
		passed: false,
	};
	await page.evaluate(() => {
		window.__rocutVisibleSeekProbe = {
			start: null,
			startEpoch: null,
			trusted: false,
		};
		window.__rocutMutationListener = (event) => {
			if (!event.target.closest?.('[data-mutation-probe="apply"]')) return;
			const state = window.__rocutVisibleSeekProbe;
			state.start = performance.now();
			state.startEpoch = performance.timeOrigin + state.start;
			state.trusted = event.isTrusted;
		};
		document.addEventListener("click", window.__rocutMutationListener, true);
	});
	try {
		observer = await createScreencastCapture({ page, cdp, displayed });
		const edit = async (text, expected) => {
			const apply = await open(text);
			let before;
			await expect
				.poll(async () => {
					before = await observer.capture();
					return before.light > 8 && before.blue > 1000;
				})
				.toBe(true);
			await page.evaluate(() => {
				window.__rocutVisibleSeekProbe = {
					start: null,
					startEpoch: null,
					trusted: false,
				};
			});
			await apply.click();
			const observations = [];
			evidence.previewMutation.lastAttempt = {
				text,
				expected,
				before,
				observations,
			};
			let previous,
				stable = 0,
				result;
			for (let attempt = 0; attempt < 160; attempt++) {
				const current = await observer.capture();
				observations.push(current);
				assert(
					current.trusted && current.milliseconds !== null,
					"Only a trusted Apply gesture may start timing",
				);
				assert(
					current.observerReturnMs < 5000,
					"Updated visible picture did not arrive",
				);
				if (current.milliseconds < 0) continue;
				const changed =
					current.hash !== before.hash &&
					current.light > 8 &&
					current.blue > 1000;
				if (expected && changed && current.hash === expected) {
					result = current;
					break;
				}
				if (!expected) {
					stable = changed && current.hash === previous ? stable + 1 : 0;
					if (stable >= 2) {
						result = current;
						break;
					}
					previous = current.hash;
				}
			}
			assert(result, "Expected changed text picture must become visible");
			await expect
				.poll(
					async () => (await read()).motionTextSequences[0].cues[cueIndex].text,
				)
				.toBe(text);
			await expect(textarea).toHaveCount(0);
			await expect(
				page.getByLabel("Edit playhead time", { exact: true }),
			).toHaveText("00:01:30:06");
			return { text, ...result, observations };
		};
		onPhase("F04 local edit: capture two distinct warm visible references");
		for (const text of ["ALPHA ALPHA", "BRAVO BRAVO"]) {
			const result = await edit(text);
			references.push(result);
			await observer.saveReference({
				path: join(work, `mutation-reference-${references.length}.png`),
				hash: result.hash,
			});
		}
		assert.notEqual(references[0].hash, references[1].hash);
		onPhase(
			"F04 local edit: thirty persisted single-cue edits with exact visible-picture matches",
		);
		for (let index = 0; index < 30; index++) {
			const ref = references[index % 2];
			samples.push(await edit(ref.text, ref.hash));
		}
		const sorted = samples.map((s) => s.milliseconds).sort((a, b) => a - b);
		const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
		Object.assign(evidence.previewMutation, {
			p95Ms: p95,
			maxMs: sorted.at(-1),
			budgetMs: 300,
		});
		const final = await read();
		assert.deepEqual(final.scenes, initial.scenes);
		assert.deepEqual(final.settings, initial.settings);
		for (let i = 0; i < sequence.cues.length; i++)
			if (i !== cueIndex)
				assert.deepEqual(
					final.motionTextSequences[0].cues[i],
					sequence.cues[i],
				);
		assert(
			p95 <= 300,
			`F04 local edit p95 ${p95.toFixed(2)}ms exceeds unchanged 300ms budget`,
		);
		evidence.previewMutation.passed = true;
		evidence.checks.push({
			name: "F04 thirty real single-cue edits preserve other cues and reach exact visible pictures within 300ms p95",
			pass: true,
			p95Ms: p95,
			maxMs: sorted.at(-1),
		});
	} finally {
		const observed = await read();
		evidence.previewMutation.finalCue =
			observed.motionTextSequences[0].cues[cueIndex];
		evidence.previewMutation.finalCuts =
			observed.motionTextSequences[0].resolvedPlan.cuts.filter(
				(c) => c.cueId === cue.id,
			);
		await observer?.close();
		await cdp.detach();
		await page.evaluate(() => {
			document.removeEventListener(
				"click",
				window.__rocutMutationListener,
				true,
			);
			delete window.__rocutMutationListener;
			delete window.__rocutVisibleSeekProbe;
		});
		// Restore only this owned test cue via the normal UI, even on failure.
		const apply = await open(cue.text);
		await apply.click();
		await expect
			.poll(
				async () => (await read()).motionTextSequences[0].cues[cueIndex].text,
			)
			.toBe(cue.text);
	}
}
