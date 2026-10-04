import assert from "node:assert/strict";
import { expect } from "@playwright/test";

const seconds = (text) => {
	const [hours, minutes, seconds, frames] = text.trim().split(":").map(Number);
	return hours * 3600 + minutes * 60 + seconds + frames / 30;
};
const readState = (page) =>
	page.evaluate(
		async () =>
			(await (await fetch(new URL("api/record", location.href))).json()).record
				.data.timelineViewState,
	);

export async function probePlaybackViewState({
	page,
	hostPage,
	evidence,
	onPhase,
}) {
	onPhase("F04 pause and reopen retain the final viewport");
	await expect
		.poll(async () => (await readState(page))?.playheadTime, { timeout: 10000 })
		.toBe(180 * 120000);
	const finalState = await readState(page);
	assert(
		finalState.scrollLeft > 0,
		"Playback must have really scrolled the timeline",
	);
	await page.reload();
	await expect(
		page.getByLabel("Edit playhead time", { exact: true }),
	).toHaveText("00:03:00:00");
	assert.deepEqual(await readState(page), finalState);
	evidence.checks.push({
		name: "F04 natural pause persists final viewport and restores playhead on reload",
		pass: true,
		state: finalState,
	});
	onPhase("F04 closing during playback retains current view");
	await page.getByLabel("Edit playhead time", { exact: true }).click();
	await page.getByLabel("Playhead time", { exact: true }).fill("00:00:00:00");
	await page.getByLabel("Playhead time", { exact: true }).press("Enter");
	await page.getByLabel("Play preview", { exact: true }).click();
	let beforeClose;
	await expect
		.poll(
			async () => {
				beforeClose = seconds(
					await page
						.getByLabel("Edit playhead time", { exact: true })
						.innerText(),
				);
				return beforeClose;
			},
			{ timeout: 20000, intervals: [500] },
		)
		.toBeGreaterThanOrEqual(8);
	await hostPage
		.locator(
			'[data-testid="chat-button-workspace-close"][data-workspace-id="rocut"]',
		)
		.click();
	await expect(hostPage.locator(
		'[data-testid="webpane-tab-slot"][data-tool-id="rocut"]',
	)).toHaveCount(0, { timeout: 20000 });
	await hostPage
		.locator('[data-testid="chat-tab-workspace"][data-workspace-id="rocut"]')
		.click();
	let reopened;
	await expect
		.poll(
			async () => {
				for (const frame of hostPage.frames())
					if (
						(await frame.title().catch(() => "")).startsWith("OpenCut editor")
					) {
						reopened = frame;
						return true;
					}
				return false;
			},
			{ timeout: 30000 },
		)
		.toBe(true);
	await expect(reopened.getByLabel("Media", { exact: true })).toBeVisible({
		timeout: 30000,
	});
	const retained = await readState(reopened);
	assert(
		retained.playheadTime >= Math.floor(beforeClose * 120000) - 4000,
		"Closing while playing must retain its latest playhead, not the previous durable position: " +
			JSON.stringify({ beforeClose, retained }),
	);
	assert(
		retained.playheadTime <= (beforeClose + 2) * 120000,
		"Reopen must not seek beyond its close interval",
	);
	await expect
		.poll(async () =>
			seconds(
				await reopened
					.getByLabel("Edit playhead time", { exact: true })
					.innerText(),
			),
		)
		.toBeCloseTo(retained.playheadTime / 120000, 1);
	evidence.checks.push({
		name: "Closing the real workspace during playback durably retains and restores the followed view",
		pass: true,
		beforeClose,
		retained,
	});
}
