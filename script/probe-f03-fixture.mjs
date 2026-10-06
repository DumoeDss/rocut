import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { expect } from "@playwright/test";

export const F03_LAYERS = [
	{
		lang: "ja",
		font: "gothic_bold",
		role: "gothic_bold",
		seed: 11223,
		color: "#00FFFF",
		x: -640,
		lines: ["風が吹く", "朝の光"],
	},
	{
		lang: "ko",
		font: "gothic_bold_ko",
		role: "gothic_bold",
		seed: 77889,
		color: "#FF00FF",
		x: 0,
		lines: ["바람이 분다", "아침의 빛"],
	},
	{
		lang: "en",
		font: "mono",
		role: "mono",
		seed: 45678,
		color: "#00FF00",
		x: 640,
		lines: ["ALPHA NORTH", "BETA SOUTH"],
	},
];

export const readF03 = (page) =>
	page.evaluate(async () => {
		const { record } = await (
			await fetch(new URL("api/record", location.href))
		).json();
		const tracks = record.data.scenes[0].tracks;
		return {
			id: record.id,
			sequences: record.data.motionTextSequences ?? [],
			clips: [tracks.main, ...tracks.overlay, ...tracks.audio].flatMap(
				(t) => t.elements,
			),
			settings: record.data.settings,
		};
	});

export async function seekF03(page, frame) {
	const label = `00:00:${String(Math.floor(frame / 30)).padStart(2, "0")}:${String(frame % 30).padStart(2, "0")}`;
	await page.getByLabel("Edit playhead time", { exact: true }).click();
	await page.getByLabel("Playhead time", { exact: true }).fill(label);
	await page.getByLabel("Playhead time", { exact: true }).press("Enter");
	await expect(
		page.getByLabel("Edit playhead time", { exact: true }),
	).toHaveText(label);
}

export async function createF03({ page, hostPage, onPhase }) {
	const layers = structuredClone(F03_LAYERS);
	for (const [index, layer] of layers.entries()) {
		onPhase(`F03 actual JIZURA import and transform: ${layer.lang}`);
		await seekF03(page, 0);
		await page
			.locator("#editor-assets")
			.getByLabel("Motion text", { exact: true })
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
			title: `F03 ${layer.lang}`,
			lang: layer.lang,
			lyrics: layer.lines.join("\n"),
			seed: layer.seed,
			fonts: { display: layer.role },
			colors: {
				enabled: true,
				accentOn: true,
				fg: layer.color,
				accent: layer.color,
			},
		});
		source.overrides = Object.fromEntries(
			layer.lines.map((text, cue) => [
				cue,
				{
					lock: true,
					lockedCuts: [
						{
							utext: text,
							layout: "huge",
							enter: "pop",
							hold: "pulse",
							exit: "shrink",
							seed: layer.seed + cue,
						},
					],
				},
			]),
		);
		const chooser = hostPage.waitForEvent("filechooser");
		await page.getByRole("button", { name: "Import", exact: true }).click();
		await (
			await chooser
		).setFiles({
			name: `f03-${layer.lang}.jizura.json`,
			mimeType: "application/json",
			buffer: Buffer.from(JSON.stringify(source)),
		});
		await expect
			.poll(async () => (await readF03(page)).sequences.length, {
				timeout: 30000,
			})
			.toBe(index + 1);
		const state = await readF03(page);
		const sequence = state.sequences.find((s) => s.language === layer.lang);
		assert(sequence);
		assert.equal(sequence.defaults.fontId, layer.font);
		assert.deepEqual(
			sequence.resolvedPlan.cuts.map((c) => c.seed),
			[layer.seed, layer.seed + 1],
		);
		assert(sequence.resolvedPlan.cuts.every((c) => c.fontId === layer.font));
		const clip = state.clips.find((c) => c.sequenceId === sequence.id);
		assert(clip && clip.startTime === 0);
		layer.clipId = clip.id;
		await page
			.locator(`[data-testid="timeline-clip"][data-element-id="${clip.id}"]`)
			.click();
		await page.getByLabel("Transform", { exact: true }).click();
		for (const [name, value, key] of [
			["Scale X", 0.28, "transform.scaleX"],
			["Scale Y", 0.28, "transform.scaleY"],
			["Position X", layer.x, "transform.positionX"],
		]) {
			const input = page.getByRole("textbox", { name, exact: true });
			await input.fill(String(value));
			await input.press("Enter");
			await expect
				.poll(
					async () =>
						(await readF03(page)).clips.find((c) => c.id === clip.id).params[
							key
						],
				)
				.toBe(value);
		}
	}
	const authored = await readF03(page);
	assert.equal(authored.clips.length, 3);
	assert.deepEqual(authored.settings.canvasSize, { width: 1920, height: 1080 });
	return { layers, authored };
}
