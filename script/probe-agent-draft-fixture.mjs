import { expect } from "@playwright/test";

export const makeAgentDraftMutation = (sequence, text) => ({
	mutation: {
		kind: "update-cue",
		cueId: sequence.cues[2].id,
		text,
		startTime: sequence.cues[2].startTime,
		duration: sequence.cues[2].duration,
		// The green-pixel oracle needs foreground-drawing typography. Random
		// layouts such as tunnel intentionally draw only accent/secondary colors.
		// This local style change is part of the reviewed proposal, not a patch
		// to the committed project or a replacement of earlier variation checks.
		preset: { mode: "starter", starterPreset: "clean-caption" },
		font: { mode: "keep" },
		colors: { mode: "set", foreground: "#00FF00", accent: "#FF0000" },
	},
	expectedSequenceRevision: sequence.revision,
});

export async function createAgentDraftFixture({ page, onPhase }) {
	onPhase("UI fixture for agent draft collaboration");
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
			"[00:00.00]第一句保持不变\n[00:02.00]第二句由用户修改\n[00:04.00]第三句等待草稿",
		);
	await page
		.getByRole("spinbutton", { name: "Duration (seconds)", exact: true })
		.fill("6");
	await page.getByTestId("motion-text-add").click();
	await expect(page.getByTestId("timeline-clip")).toHaveCount(1);
}
