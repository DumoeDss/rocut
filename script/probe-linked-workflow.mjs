import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { probeCueLockWorkflow } from "./probe-cue-lock-workflow.mjs";
import { probeMotionClipContinuity } from "./probe-motion-clip-continuity.mjs";
import { probeAgentDrafts } from "./probe-agent-drafts.mjs";

export async function probeLinkedWorkflow({
	page,
	hostPage,
	project,
	work,
	evidence,
	onPhase,
}) {
	evidence.linkedWorkflow = {
		status: "partial",
		completedSections: [],
		pendingSections: [9, "10-range", 12],
	};
	const record = await page.evaluate(
		async () =>
			(await (await fetch(new URL("api/record", location.href))).json()).record,
	);
	const disk = JSON.parse(readFileSync(join(project, "project.json"), "utf8"));
	assert.equal(
		record.id,
		disk.record.id,
		"real Creator entry must load the newly-created dedicated fixture",
	);
	assert(record.id, "fixture identity must exist");
	evidence.linkedWorkflow.projectId = record.id;
	const video = join(work, "continuity-underlay.mp4");
	execFileSync(
		"ffmpeg",
		[
			"-v",
			"error",
			"-n",
			"-f",
			"lavfi",
			"-i",
			"color=c=red:s=640x360:r=30:d=8",
			"-f",
			"lavfi",
			"-i",
			"sine=frequency=660:duration=8",
			"-c:v",
			"libx264",
			"-pix_fmt",
			"yuv420p",
			"-c:a",
			"aac",
			"-shortest",
			video,
		],
		{ windowsHide: true },
	);
	evidence.linkedWorkflow.mediaSha256 = createHash("sha256")
		.update(readFileSync(video))
		.digest("hex");
	const afterCreate = async (frame) => {
		onPhase("same-project cyan lyric palette and audiovisual media import");
		await frame
			.getByRole("button", { name: "Edit font and colors", exact: true })
			.click();
		const customize = frame.getByRole("button", {
			name: "Customize",
			exact: true,
		});
		const form = frame
			.getByRole("button", { name: /^(Customize|Use preset colors)$/ })
			.locator("..")
			.locator("..");
		await customize.click();
		for (const label of ["Text", "Accent"]) {
			const field = form
				.locator("label")
				.filter({ hasText: new RegExp("^" + label + "$") })
				.locator("..")
				.getByRole("textbox");
			await field.fill("00FFFF");
			await field.press("Tab");
		}
		await form
			.getByRole("button", { name: "Apply changes", exact: true })
			.click();
		await frame.getByLabel("Media", { exact: true }).click();
		await frame.locator('input[type="file"]').setInputFiles(video);
		await frame
			.getByLabel("Add continuity-underlay.mp4 to timeline", { exact: true })
			.click();
		await expect(frame.getByTestId("timeline-clip")).toHaveCount(2);
		const id = await frame.evaluate(async () => {
			const { record } = await (
				await fetch(new URL("api/record", location.href))
			).json();
			return [
				record.data.scenes[0].tracks.main,
				...record.data.scenes[0].tracks.overlay,
			]
				.flatMap((t) => t.elements)
				.find((c) => c.type === "motion-text").id;
		});
		await frame
			.locator('[data-testid="timeline-clip"][data-element-id="' + id + '"]')
			.click();
	};
	page = await probeCueLockWorkflow({
		page,
		hostPage,
		work,
		evidence,
		onPhase,
		afterCreate,
	});
	evidence.linkedWorkflow.completedSections.push(1, 2, 3, 4);
	const timeline = await probeMotionClipContinuity({
		page,
		hostPage,
		work,
		evidence,
		onPhase,
		existingLyrics: true,
	});
	evidence.linkedWorkflow.completedSections.push(5, 6, 7, "10-full");
	page = await probeAgentDrafts({
		page: timeline.page,
		hostPage,
		project,
		work,
		evidence,
		onPhase,
		existingTimeline: timeline.existingTimeline,
	});
	const final = await page.evaluate(
		async () =>
			(await (await fetch(new URL("api/record", location.href))).json()).record,
	);
	assert.equal(final.id, record.id);
	assert.deepEqual(final.data.scenes, timeline.state.scenes);
	assert.deepEqual(
		final.data.motionTextSequences[0].cues[1].locks,
		timeline.state.sequences[0].cues[1].locks,
	);
	evidence.linkedWorkflow.completedSections.push(8, 11);
	evidence.checks.push({
		name: "Agent review and reopening preserve the same project identity, edited timeline, media references and second-cue locks",
		pass: true,
	});
}
