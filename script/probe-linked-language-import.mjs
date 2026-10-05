import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { expect } from "@playwright/test";

export async function appendEnglishOverlay({
	page,
	hostPage,
	before,
	read,
	clips,
	onPhase,
}) {
	await page
		.locator('[aria-label="Media"]')
		.locator("..")
		.locator('[aria-label="Motion text"]')
		.click();
	const source = JSON.parse(
		readFileSync(
			new URL(
				"../rust/crates/motion-text/fixtures/jizura-v1-project.json",
				import.meta.url,
			),
			"utf8",
		),
	);
	Object.assign(source, {
		title: "Linked English overlay",
		lang: "en",
		lyrics: "ALPHA NORTH\nBETA SOUTH",
		seed: 77889,
		colors: { enabled: true, accentOn: true, fg: "#FF00FF", accent: "#FF00FF" },
	});
	source.overrides = Object.fromEntries(
		["ALPHA NORTH", "BETA SOUTH"].map((utext, i) => [
			i,
			{
				lock: true,
				lockedCuts: [
					{
						utext,
						layout: "huge",
						enter: "pop",
						hold: "pulse",
						exit: "shrink",
						seed: 77889 + i,
					},
				],
			},
		]),
	);
	onPhase("import English into the same edited and reviewed project");
	const chooser = hostPage.waitForEvent("filechooser");
	await page.getByRole("button", { name: "Import", exact: true }).click();
	await (
		await chooser
	).setFiles({
		name: "linked-en.jizura.json",
		mimeType: "application/json",
		buffer: Buffer.from(JSON.stringify(source)),
	});
	await expect
		.poll(async () => (await read()).data.motionTextSequences.length)
		.toBe(before.data.motionTextSequences.length + 1);
	const imported = await read();
	const english = imported.data.motionTextSequences.find(
		(s) => !before.data.motionTextSequences.some((old) => old.id === s.id),
	);
	assert.equal(english.language, "en");
	assert.equal(english.defaults.fontId, "gothic_bold");
	assert.deepEqual(
		english.resolvedPlan.cuts.map((c) => c.seed),
		[77889, 77890],
	);
	const clip = clips(imported).find((c) => c.sequenceId === english.id);
	assert.equal(clip.startTime, 0);
	await page
		.locator(`[data-testid="timeline-clip"][data-element-id="${clip.id}"]`)
		.click();
	await page.getByLabel("Transform", { exact: true }).click();
	for (const [name, value, key] of [
		["Scale X", 0.3, "transform.scaleX"],
		["Scale Y", 0.3, "transform.scaleY"],
		["Position Y", -360, "transform.positionY"],
	]) {
		const input = page.getByRole("textbox", { name, exact: true });
		await input.fill(String(value));
		await input.press("Enter");
		await expect
			.poll(
				async () =>
					clips(await read()).find((c) => c.id === clip.id).params[key],
			)
			.toBe(value);
	}
	return { english, clip };
}
