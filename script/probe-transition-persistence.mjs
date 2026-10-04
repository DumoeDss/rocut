import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect } from "@playwright/test";

// Storage fixture + real UI edit/history/reopen acceptance. This is NOT transition
// authoring UI or rendered dissolve acceptance; those remain a separate milestone.
export async function probeTransitionPersistence({
	page,
	work,
	evidence,
	onPhase,
}) {
	const record = () =>
		page.evaluate(
			async () =>
				(await (await fetch(new URL("api/record", location.href))).json())
					.record,
		);
	const clips = async () =>
		(await record()).data.scenes[0].tracks.main.elements;
	onPhase("transition storage fixture");
	const source = join(work, "transition-source.png");
	execFileSync(
		"ffmpeg",
		[
			"-v",
			"error",
			"-n",
			"-f",
			"lavfi",
			"-i",
			"color=c=red:s=640x360",
			"-frames:v",
			"1",
			source,
		],
		{ windowsHide: true },
	);
	await page.getByLabel("Media", { exact: true }).click();
	await page.locator('input[type="file"]').setInputFiles(source);
	const list = page.getByLabel("Switch to list view", { exact: true });
	if (await list.count()) await list.click();
	await page
		.getByLabel("Add transition-source.png to timeline", { exact: true })
		.click();
	await expect.poll(async () => (await clips()).length).toBe(1);
	// Settle deferred view state before seeding the owned test record.
	await page.reload();
	const seeded = await page.evaluate(async () => {
		const url = new URL("api/record", location.href);
		const envelope = await (await fetch(url)).json();
		const track = envelope.record.data.scenes[0].tracks.main;
		const source = track.elements[0];
		const outgoing = {
			...source,
			name: "Transition outgoing",
			startTime: 0,
			duration: 240000,
			trimStart: 0,
			trimEnd: 0,
		};
		const incoming = {
			...source,
			id: crypto.randomUUID(),
			name: "Transition incoming",
			startTime: 240000,
			duration: 240000,
			trimStart: 0,
			trimEnd: 0,
			transitionIn: {
				kind: "cross-dissolve",
				outgoingClipId: outgoing.id,
				durationFrames: 30,
			},
		};
		track.elements = [outgoing, incoming];
		const response = await fetch(url, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(envelope),
		});
		if (!response.ok)
			throw Error("Cannot write owned transition fixture: " + response.status);
		return { outgoing, incoming };
	});
	await page.reload();
	assert.deepEqual(await clips(), [seeded.outgoing, seeded.incoming]);
	evidence.checks.push({
		name: "incoming transition survives installed codec reopen",
		pass: true,
		fixtureSetup: "seeded owned storage; not transition authoring UI",
	});
	onPhase("transition real delete undo redo");
	// Timeline cards display the media filename, not the donor element name.
	const labels = page.getByText("transition-source.png", { exact: true });
	await expect(labels).toHaveCount(3); // library item, outgoing, incoming
	await labels.nth(1).click();
	await page.evaluate(() => {
		globalThis.__transitionFocusEvents = [];
		for (const type of ["focusin", "focusout"])
			document.addEventListener(
				type,
				(event) => {
					globalThis.__transitionFocusEvents.push({
						type,
						target: event.target?.tagName,
						connected: event.target?.isConnected,
						related: event.relatedTarget?.tagName,
						active: document.activeElement?.tagName,
					});
				},
				true,
			);
	});
	await page.keyboard.press("Delete");
	await expect.poll(async () => (await clips()).length).toBe(1);
	const cleaned = (await clips())[0];
	assert.equal(cleaned.id, seeded.incoming.id);
	assert.equal(cleaned.transitionIn, undefined);
	evidence.focusAfterDelete = await page.evaluate(() => ({
		active: document.activeElement?.tagName,
		events: globalThis.__transitionFocusEvents,
	}));
	assert(
		await page.evaluate(
			() =>
				!!document
					.querySelector("[data-editor-surface]")
					?.contains(document.activeElement),
		),
		"Deleting the focused clip must preserve scoped keyboard access",
	);
	await page.keyboard.press("Control+z");
	await expect.poll(async () => (await clips()).length).toBe(2);
	assert.deepEqual(await clips(), [seeded.outgoing, seeded.incoming]);
	await page.keyboard.press("Control+Shift+z");
	await expect.poll(async () => (await clips()).length).toBe(1);
	assert.equal((await clips())[0].transitionIn, undefined);
	evidence.checks.push({
		name: "real Delete atomically clears stale relation and one-step undo/redo restores both",
		pass: true,
	});
	await page.reload();
	assert.deepEqual(await clips(), [cleaned]);
	evidence.checks.push({
		name: "cleaned transition does not resurrect from retained donor data on reload",
		pass: true,
	});
	evidence.notTransitionUiOrRenderAcceptance = true;
}
