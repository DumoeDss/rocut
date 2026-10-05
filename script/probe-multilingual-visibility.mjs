import assert from "node:assert/strict";
import { expect } from "@playwright/test";
import { languagePreview } from "./probe-multilingual-media.mjs";

export async function probeLanguageVisibility({
	page,
	hostPage,
	readState,
	seek,
	authored,
	baseline,
	definitions,
	evidence,
}) {
	for (const definition of definitions) {
		await page
			.locator(
				'[data-testid="timeline-clip"][data-element-id="' +
					definition.clipId +
					'"]',
			)
			.click({ button: "right" });
		await page.getByRole("menuitem", { name: "Hide", exact: true }).click();
		await expect
			.poll(
				async () =>
					(await readState()).clips.find((c) => c.id === definition.clipId)
						.hidden,
			)
			.toBe(true);
		await seek(69);
		const hidden = definition.lang === "en" ? "magenta" : "cyan";
		const retained = hidden === "magenta" ? "cyan" : "magenta";
		await expect
			.poll(
				async () => {
					const sample = await languagePreview(page);
					return { hidden: sample[hidden].length, retained: sample[retained] };
				},
				{ timeout: 15000 },
			)
			.toEqual({ hidden: 0, retained: baseline[retained] });
		const after = await readState();
		assert.deepEqual(after.sequences, authored.sequences);
		await hostPage.keyboard.press("Control+z");
		await expect.poll(readState).toEqual(authored);
		await expect
			.poll(async () => (await languagePreview(page)).hash, { timeout: 15000 })
			.toBe(baseline.hash);
		evidence.checks.push({
			name:
				"hiding " +
				definition.lang +
				" via the clip menu leaves the other language pixels unchanged; undo restores exact composition",
			pass: true,
		});
	}
}
