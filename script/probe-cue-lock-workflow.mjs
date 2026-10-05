import assert from "node:assert/strict";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { languagePreview } from "./probe-multilingual-media.mjs";

export async function probeCueLockWorkflow({
	page,
	hostPage,
	work,
	evidence,
	onPhase,
}) {
	await hostPage.setViewportSize({ width: 1920, height: 1080 });
	const readState = () =>
		page.evaluate(async () => {
			const { record } = await (
				await fetch(new URL("api/record", location.href))
			).json();
			return {
				sequences: record.data.motionTextSequences ?? [],
				scenes: record.data.scenes,
				settings: record.data.settings,
			};
		});
	const sequence = async () => (await readState()).sequences[0];
	const cueRows = () =>
		page.locator(
			'[aria-labelledby="motion-text-cues-heading"] button[aria-expanded]',
		);
	const capture = async (frame) => {
		await page.getByLabel("Edit playhead time", { exact: true }).click();
		await page
			.getByLabel("Playhead time", { exact: true })
			.fill(
				"00:00:" +
					String(Math.floor(frame / 30)).padStart(2, "0") +
					":" +
					String(frame % 30).padStart(2, "0"),
			);
		await page.getByLabel("Playhead time", { exact: true }).press("Enter");
		await page.waitForTimeout(400);
		let sample,
			previous,
			streak = 0;
		await expect
			.poll(
				async () => {
					sample = await languagePreview(page);
					streak = sample.hash === previous ? streak + 1 : 1;
					previous = sample.hash;
					return streak >= 3;
				},
				{ timeout: 20000 },
			)
			.toBe(true);
		return sample.hash;
	};
	const check = (name, details = {}) =>
		evidence.checks.push({ name, pass: true, ...details });
	onPhase("create timestamped three-cue text and apply typographic preset");
	await page.getByLabel("Motion text", { exact: true }).click();
	await page
		.getByRole("combobox", { name: "Lyrics format", exact: true })
		.click();
	await page
		.getByRole("option", { name: "LRC timestamps", exact: true })
		.click();
	await page
		.locator("#motion-text-source")
		.fill(
			"[00:00.00]让画面开始说话\n[00:02.00]第二句等待修改\n[00:04.00]让节奏清晰可见",
		);
	await page
		.getByRole("spinbutton", { name: "Duration (seconds)", exact: true })
		.fill("6");
	await page.getByTestId("motion-text-add").click();
	await expect(page.getByTestId("timeline-clip")).toHaveCount(1);
	await page.locator('[data-motion-text-preset-card="style:specimen"]').click();
	await page.getByTestId("motion-text-apply-preset").click();
	await expect
		.poll(async () =>
			(await sequence()).resolvedPlan.cuts.every(
				(c) => c.preset.style === "specimen",
			),
		)
		.toBe(true);
	const initial = await readState(),
		initialSequence = initial.sequences[0],
		cueId = initialSequence.cues[1].id;
	assert.deepEqual(
		initialSequence.cues.map((c) => c.startTime),
		[0, 240000, 480000],
	);
	onPhase("edit second cue without altering other cues or timing");
	await cueRows().nth(1).click();
	const textarea = page.locator('textarea[id="motion-text-cue-' + cueId + '"]');
	await textarea.fill("第二句已经修改");
	await textarea
		.locator("..")
		.locator("..")
		.getByRole("button", { name: "Apply changes", exact: true })
		.click();
	await expect
		.poll(async () => (await sequence()).cues[1].text)
		.toBe("第二句已经修改");
	const edited = await readState(),
		editSequence = edited.sequences[0];
	for (const index of [0, 2])
		assert.deepEqual(editSequence.cues[index], initialSequence.cues[index]);
	assert.deepEqual(
		editSequence.cues.map((c) => [c.id, c.startTime, c.duration]),
		initialSequence.cues.map((c) => [c.id, c.startTime, c.duration]),
	);
	assert.deepEqual(editSequence.defaults, initialSequence.defaults);
	await hostPage.keyboard.press("Control+z");
	await expect.poll(readState).toEqual(initial);
	await hostPage.keyboard.press("Control+Shift+z");
	await expect.poll(readState).toEqual(edited);
	check(
		"second cue text edit is one undo redo transaction and preserves other cues and timing",
	);
	onPhase("lock second cue layout and entrance through real controls");
	await cueRows().nth(1).click();
	const locks = page.locator(
		'[aria-labelledby="motion-text-locks-' + cueId + '"]',
	);
	for (const [name, key] of [
		["Layout", "layout"],
		["Enter", "enter"],
	]) {
		await locks.getByRole("button", { name, exact: true }).click();
		await expect
			.poll(async () =>
				(await sequence()).cues[1].locks.some(
					(l) => l.scope === "preset-group" && l.key === key,
				),
			)
			.toBe(true);
	}
	const locked = await readState(),
		lockedSequence = locked.sequences[0];
	const lockedCuts = lockedSequence.resolvedPlan.cuts.filter(
		(c) => c.cueId === cueId,
	);
	const variation = page
		.getByRole("heading", { name: "Variation", exact: true })
		.locator("..")
		.locator("..");
	for (const name of ["Style", "Motion", "Exit", "Treatment", "Camera"]) {
		await variation.getByRole("button", { name, exact: true }).click();
	}
	const groups = variation.getByLabel("Variation groups", { exact: true });
	assert.deepEqual(
		await groups.locator('button[aria-pressed="true"]').allTextContents(),
		["Layout", "Enter"],
	);
	await variation
		.getByRole("button", { name: "Selected cue", exact: true })
		.click();
	await variation
		.getByRole("button", { name: "Generate variation", exact: true })
		.click();
	await expect(page.getByRole("alert")).toContainText("fully locked");
	assert.deepEqual(await readState(), locked);
	await expect(
		variation.getByRole("button", { name: "Apply variation", exact: true }),
	).toBeDisabled();
	check(
		"fully locked selected groups reject a no-op variation without changing the project",
	);
	await variation
		.getByRole("button", { name: "All cues", exact: true })
		.click();
	const baselineFirst = await capture(30),
		baselineSecond = await capture(90);
	onPhase("preview cancel and reroll vary unlocked cues only");
	await variation
		.getByRole("button", { name: "Generate variation", exact: true })
		.click();
	await expect(
		variation.getByText("Canvas preview", { exact: true }),
	).toBeVisible();
	assert.deepEqual(await readState(), locked);
	assert.equal(
		await capture(90),
		baselineSecond,
		"partial locks must preserve selected group's visible result",
	);
	const previewFirst = await capture(30);
	assert.notEqual(
		previewFirst,
		baselineFirst,
		"unlocked first cue must actually preview a different layout or entrance",
	);
	await variation.getByRole("button", { name: "Cancel", exact: true }).click();
	assert.equal(await capture(30), baselineFirst);
	assert.deepEqual(await readState(), locked);
	await variation
		.getByRole("button", { name: "Generate variation", exact: true })
		.click();
	assert.equal(
		await capture(30),
		previewFirst,
		"same salt must regenerate the same candidate",
	);
	await variation
		.getByRole("button", { name: "Reroll variation", exact: true })
		.click();
	assert.deepEqual(await readState(), locked);
	const rerolledFirst = await capture(30);
	assert.equal(await capture(90), baselineSecond);
	await variation
		.getByRole("button", { name: "Apply variation", exact: true })
		.click();
	await expect
		.poll(async () => (await sequence()).revision)
		.toBeGreaterThan(lockedSequence.revision);
	const applied = await readState(),
		appliedSequence = applied.sequences[0];
	assert.deepEqual(
		appliedSequence.resolvedPlan.cuts.filter((c) => c.cueId === cueId),
		lockedCuts,
	);
	assert.deepEqual(appliedSequence.cues, lockedSequence.cues);
	assert.notDeepEqual(
		appliedSequence.resolvedPlan.cuts.filter((c) => c.cueId !== cueId),
		lockedSequence.resolvedPlan.cuts.filter((c) => c.cueId !== cueId),
	);
	assert.equal(await capture(30), rerolledFirst);
	assert.equal(await capture(90), baselineSecond);
	check(
		"preview cancel deterministic regeneration and reroll preserve both locked groups while changing unlocked cue frames",
	);
	await variation
		.getByRole("button", { name: "Generate variation", exact: true })
		.focus();
	await hostPage.keyboard.press("Control+z");
	await expect.poll(readState).toEqual(locked);
	await hostPage.keyboard.press("Control+Shift+z");
	await expect.poll(readState).toEqual(applied);
	onPhase("close and reopen actual Rocut workspace after locked cue variation");
	const editorUrl = page.url();
	await hostPage
		.locator(
			'[data-testid="chat-button-workspace-close"][data-workspace-id="rocut"]',
		)
		.click();
	await expect(
		hostPage.locator('[data-testid="webpane-tab-slot"][data-tool-id="rocut"]'),
	).toHaveCount(0);
	await hostPage
		.locator('[data-testid="chat-tab-workspace"][data-workspace-id="rocut"]')
		.click();
	await expect
		.poll(
			() => {
				const reopened = hostPage
					.frames()
					.find((frame) => frame.url() === editorUrl);
				if (reopened) page = reopened;
				return !!reopened;
			},
			{ timeout: 30000 },
		)
		.toBe(true);
	await page.getByTestId("timeline-clip").click({ timeout: 30000 });
	assert.deepEqual(await readState(), applied);
	await cueRows().nth(1).click();
	await expect(
		page.getByRole("textbox", { name: "Lyric text", exact: true }),
	).toHaveValue("第二句已经修改");
	for (const name of ["Layout", "Enter"])
		await expect(
			page
				.locator('[aria-labelledby="motion-text-locks-' + cueId + '"]')
				.getByRole("button", { name, exact: true }),
		).toHaveAttribute("aria-pressed", "true");
	assert.equal(await capture(30), rerolledFirst);
	assert.equal(await capture(90), baselineSecond);
	await hostPage.screenshot({
		path: join(work, "cue-lock-workflow-reopened.png"),
	});
	check(
		"actual workspace close reopen preserves edited cue text both locks varied plans and exact preview frames",
	);
}
