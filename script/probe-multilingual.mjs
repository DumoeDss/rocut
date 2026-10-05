import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "@playwright/test";
import {
	languagePreview,
	assertBothLanguages,
	verifyLanguageExport,
} from "./probe-multilingual-media.mjs";
import { downloadUiExport } from "./probe-ui-export-fixture.mjs";
import { probeLanguageVisibility } from "./probe-multilingual-visibility.mjs";

export async function probeMultilingual({
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
			const tracks = record.data.scenes[0].tracks;
			return {
				sequences: record.data.motionTextSequences ?? [],
				clips: [tracks.main, ...tracks.overlay, ...tracks.audio].flatMap(
					(t) => t.elements,
				),
				settings: record.data.settings,
			};
		});
	const seek = async (frame) => {
		const label =
			"00:00:" +
			String(Math.floor(frame / 30)).padStart(2, "0") +
			":" +
			String(frame % 30).padStart(2, "0");
		await page.getByLabel("Edit playhead time", { exact: true }).click();
		await page.getByLabel("Playhead time", { exact: true }).fill(label);
		await page.getByLabel("Playhead time", { exact: true }).press("Enter");
		await expect(
			page.getByLabel("Edit playhead time", { exact: true }),
		).toHaveText(label);
		await hostPage.keyboard.press("Escape");
	};
	const definitions = [
		{
			title: "Chinese isolation",
			lang: "zh-Hans",
			lyrics: ["风从城里来", "灯在雨里亮"],
			color: "#00FFFF",
			seed: 11223,
			x: -480,
			font: "gothic_bold_zh_hans",
		},
		{
			title: "English isolation",
			lang: "en",
			lyrics: ["ALPHA NORTH", "BETA SOUTH"],
			color: "#FF00FF",
			seed: 77889,
			x: 480,
			font: "gothic_bold",
		},
	];
	for (const [index, definition] of definitions.entries()) {
		onPhase("import and transform " + definition.lang + " overlay");
		await seek(0);
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
			title: definition.title,
			lang: definition.lang,
			lyrics: definition.lyrics.join("\n"),
			seed: definition.seed,
			colors: {
				enabled: true,
				accentOn: true,
				fg: definition.color,
				accent: definition.color,
			},
		});
		source.overrides = Object.fromEntries(
			definition.lyrics.map((text, cue) => [
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
							seed: definition.seed + cue,
						},
					],
				},
			]),
		);
		const fileChooser = hostPage.waitForEvent("filechooser");
		await page.getByRole("button", { name: "Import", exact: true }).click();
		await (
			await fileChooser
		).setFiles({
			name: definition.lang + ".jizura.json",
			mimeType: "application/json",
			buffer: Buffer.from(JSON.stringify(source)),
		});
		await expect
			.poll(async () => (await readState()).sequences.length, {
				timeout: 30000,
			})
			.toBe(index + 1);
		const state = await readState();
		const sequence = state.sequences.find(
			(s) => s.language === definition.lang,
		);
		assert(sequence);
		assert.equal(sequence.defaults.fontId, definition.font);
		assert.equal(sequence.compositionMode, "overlay");
		assert.deepEqual(
			sequence.resolvedPlan.cuts.map((c) => c.seed),
			[definition.seed, definition.seed + 1],
		);
		const clip = state.clips.find((c) => c.sequenceId === sequence.id);
		assert(clip && clip.startTime === 0);
		definition.clipId = clip.id;
		await page
			.locator(
				'[data-testid="timeline-clip"][data-element-id="' + clip.id + '"]',
			)
			.click();
		await page.getByLabel("Transform", { exact: true }).click();
		for (const [name, value, key] of [
			["Scale X", 0.4, "transform.scaleX"],
			["Scale Y", 0.4, "transform.scaleY"],
			["Position X", definition.x, "transform.positionX"],
		]) {
			const input = page.getByRole("textbox", { name, exact: true });
			await input.fill(String(value));
			await input.press("Enter");
			await expect
				.poll(
					async () =>
						(await readState()).clips.find((c) => c.id === clip.id).params[key],
				)
				.toBe(value);
		}
	}
	const authored = await readState();
	assert.equal(authored.clips.length, 2);
	assert.deepEqual(
		authored.sequences.map((s) => ({
			language: s.language,
			duration: s.duration,
		})),
		[
			{ language: "zh-Hans", duration: 528000 },
			{ language: "en", duration: 648000 },
		],
	);
	const durationTicks = Math.max(
		...authored.clips.map((clip) => clip.startTime + clip.duration),
	);
	assert.deepEqual(authored.settings.canvasSize, { width: 1920, height: 1080 });
	evidence.checks.push({
		name: "actual JIZURA imports preserve distinct language fonts, locked seeds and simultaneous transformed overlay clips",
		pass: true,
	});
	const baselines = new Map();
	for (const frame of [24, 36, 69, 87]) {
		onPhase("multilingual baseline frame " + frame);
		await seek(frame);
		// Functional determinism, not the F04 latency benchmark. Allow asynchronous
		// font/frame work, then require three consecutive identical visible frames.
		await page.waitForTimeout(400);
		let previous,
			streak = 0,
			sample;
		await expect
			.poll(
				async () => {
					sample = await languagePreview(page);
					try {
						assertBothLanguages(sample);
					} catch (error) {
						streak = 0;
						return error.message;
					}
					streak = sample.hash === previous ? streak + 1 : 1;
					previous = sample.hash;
					return streak >= 3 ? null : "waiting for stable frame";
				},
				{ timeout: 30000 },
			)
			.toBeNull();
		baselines.set(frame, sample);
		await hostPage.screenshot({
			path: join(work, "languages-frame-" + frame + ".png"),
		});
	}
	assert(
		new Set([...baselines.values()].map((s) => s.hash)).size >= 3,
		"multiple timestamps must not collapse to one stale frame",
	);
	const fonts = await page.evaluate(() =>
		Array.from(document.fonts, (font) => ({
			family: font.family,
			status: font.status,
		})).filter((font) => font.family.startsWith("__rocut_mt_")),
	);
	for (const definition of definitions)
		assert(
			fonts.some(
				(font) =>
					new RegExp("^__rocut_mt_" + definition.font + "_[a-f0-9]{16}$").test(
						font.family,
					) && font.status === "loaded",
			),
			definition.lang + " must use an actually loaded isolated font face",
		);
	evidence.fontFaces = fonts;
	onPhase("multilingual out-of-order seeks");
	for (const frame of [87, 24, 69, 36, 24, 87, 36, 69]) {
		await seek(frame);
		await expect
			.poll(async () => (await languagePreview(page)).hash, { timeout: 15000 })
			.toBe(baselines.get(frame).hash);
	}
	assert.deepEqual(await readState(), authored);
	evidence.checks.push({
		name: "both colored language layers reproduce exact per-time pixels across eight out-of-order UI seeks without changing fonts, seeds or plans",
		pass: true,
	});
	onPhase("multilingual clip visibility isolation");
	await probeLanguageVisibility({
		page,
		hostPage,
		readState,
		seek,
		authored,
		baseline: baselines.get(69),
		definitions,
		evidence,
	});
	onPhase("multilingual reopened frame isolation");
	await page.reload();
	await expect.poll(readState).toEqual(authored);
	for (const frame of [69, 24, 87, 36]) {
		await seek(frame);
		await expect
			.poll(async () => (await languagePreview(page)).hash, { timeout: 30000 })
			.toBe(baselines.get(frame).hash);
	}
	evidence.checks.push({
		name: "multilingual font, seed and per-frame output isolation survives a real iframe reload",
		pass: true,
	});
	onPhase("multilingual actual UI export");
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
		evidence.checks.push({
			name: "actual full-duration MP4 export preserves both language glyph regions at four authored times",
			pass: true,
			...verifyLanguageExport({ output, baselines, durationTicks }),
		});
	} finally {
		await cdp.send("Browser.setDownloadBehavior", { behavior: "default" });
		await cdp.detach();
	}
}
