import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { expect } from "@playwright/test";
import { downloadUiExport } from "./probe-ui-export-fixture.mjs";

export async function probeUnknownPreset({
	page,
	hostPage,
	work,
	evidence,
	onPhase,
}) {
	const original = JSON.parse(
		readFileSync(
			new URL(
				"../rust/crates/motion-text/fixtures/jizura-v1-project.json",
				import.meta.url,
			),
			"utf8",
		),
	);
	const state = () =>
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
	await page.getByLabel("Motion text", { exact: true }).click();
	const button = page.getByRole("button", { name: "Import", exact: true });
	const card = button.locator("..").locator("..");
	const upload = async (source) => {
		const chooser = hostPage.waitForEvent("filechooser");
		await button.click();
		await (
			await chooser
		).setFiles({
			name: "unknown-preset.jizura.json",
			mimeType: "application/json",
			buffer: Buffer.from(JSON.stringify(source)),
		});
	};
	const before = await state();
	for (const kind of ["cue", "cut", "locked-cut"]) {
		onPhase("reject unknown " + kind + " preset without mutation");
		const source = structuredClone(original);
		const id = "future-layout-" + kind;
		if (kind === "cue") source.overrides["0"].layout = id;
		else if (kind === "cut") source.overrides["1"].cutTech["0"].layout = id;
		else
			source.overrides["0"] = {
				lock: true,
				lockedCuts: [
					{
						utext: "风从城里来",
						layout: id,
						enter: "pop",
						hold: "pulse",
						exit: "shrink",
						seed: 12345,
					},
				],
			};
		await upload(source);
		await expect(card.getByRole("alert")).toContainText(id);
		await expect(card.getByRole("alert")).toContainText(
			"does not support imported preset",
		);
		await expect(page.getByTestId("timeline-clip")).toHaveCount(0);
		assert.deepEqual(
			await state(),
			before,
			"rejected import cannot mutate the project",
		);
		evidence.checks.push({
			name:
				"unknown " +
				kind +
				" preset displays its exact identifier and leaves the project unchanged",
			pass: true,
			notice: await card.getByRole("alert").innerText(),
		});
	}
	onPhase("import corrected source using same file chooser");
	await upload(original);
	await expect(card.getByRole("status")).toContainText(
		"Imported 2 lyric lines",
	);
	await expect(card.getByRole("alert")).toHaveCount(0);
	await expect(page.getByTestId("timeline-clip")).toHaveCount(1);
	await expect.poll(async () => (await state()).sequences.length).toBe(1);
	const corrected = await state();
	assert.equal(corrected.sequences[0].source.text, JSON.stringify(original));
	const first = corrected.sequences[0].resolvedPlan.cuts[0];
	assert.equal(first.preset.layout, "huge");
	await hostPage.keyboard.press("Control+z");
	await expect.poll(state).toEqual(before);
	await hostPage.keyboard.press("Control+Shift+z");
	await expect.poll(state).toEqual(corrected);
	await page.reload();
	await expect(page.getByLabel("Media", { exact: true })).toBeVisible({
		timeout: 30000,
	});
	assert.deepEqual(await state(), corrected);
	evidence.checks.push({
		name: "corrected preset source imports in the same editor, retains exact provenance and survives undo redo and reload",
		pass: true,
	});
	onPhase("export corrected preset project through actual menu");
	const cdp = await hostPage.context().browser().newBrowserCDPSession();
	try {
		await cdp.send("Browser.setDownloadBehavior", {
			behavior: "allowAndName",
			downloadPath: work,
			eventsEnabled: true,
		});
		await page.getByTestId("editor-menu-trigger").click();
		await page
			.getByRole("menuitem", { name: "Export project", exact: true })
			.click();
		const output = await downloadUiExport(
			cdp,
			page.getByRole("dialog", { name: "Export project", exact: true }),
			work,
		);
		const info = JSON.parse(
			execFileSync(
				"ffprobe",
				[
					"-v",
					"error",
					"-count_frames",
					"-show_entries",
					"stream=codec_name,width,height,nb_read_frames",
					"-of",
					"json",
					output.path,
				],
				{ encoding: "utf8", windowsHide: true },
			),
		);
		assert(
			info.streams.some(
				(s) =>
					s.codec_name === "h264" &&
					s.width === 1920 &&
					s.height === 1080 &&
					Number(s.nb_read_frames) === 132,
			),
		);
		execFileSync(
			"ffmpeg",
			["-v", "error", "-i", output.path, "-f", "null", "-"],
			{ windowsHide: true },
		);
		assert.deepEqual(await state(), corrected);
		evidence.checks.push({
			name: "corrected preset project exports a fully decoded 132-frame H264 MP4 without modifying the project",
			pass: true,
			info,
		});
	} finally {
		await cdp.send("Browser.setDownloadBehavior", { behavior: "default" });
		await cdp.detach();
	}
}
