import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { mainPreviewCanvas } from "./probe-multilingual-media.mjs";
import { captureExportReference } from "./probe-export-reference.mjs";
import {
	sampleContinuityExportPng,
	compareContinuityExport,
	assertContinuityExport,
} from "./probe-continuity-export-pixels.mjs";
import { createRangeSource } from "./probe-ui-range-media.mjs";
import { downloadUiExport } from "./probe-ui-export-fixture.mjs";

// Four real form-created sequences; no state injection or system-font fallback.
export async function probeF02Languages({
	page,
	hostPage,
	work,
	evidence,
	onPhase,
}) {
	await hostPage.setViewportSize({ width: 1920, height: 1080 });
	const definitions = [
		{
			language: "ja",
			label: "Japanese",
			font: "gothic_bold",
			lines: ["風", "夜の街、そして朝へ。", "日本語の句読点：『光』、１２３。"],
		},
		{
			language: "ko",
			label: "Korean",
			font: "gothic_bold_ko",
			lines: [
				"바람",
				"밤의 도시, 그리고 아침.",
				"한국어 문장: 빛과 리듬, 123.",
			],
		},
		{
			language: "en",
			label: "English",
			font: "gothic_bold",
			lines: [
				"Sky",
				"A longer sentence, carried by the wind.",
				"Punctuation: (light), rhythm; 123.",
			],
		},
		{
			language: "ko",
			label: "Korean",
			font: "gothic_bold_ko",
			lines: [
				"風 hello 바람",
				"中文と日本語, 한국어 and English.",
				"混排：빛、光, 123。 ",
			],
		},
	];
	const read = () =>
		page.evaluate(async () => {
			const { record } = await (
				await fetch(new URL("api/record", location.href))
			).json();
			return {
				sequences: record.data.motionTextSequences,
				scenes: record.data.scenes,
			};
		});
	const seek = async (frame) => {
		await page.getByLabel("Edit playhead time", { exact: true }).click();
		await page
			.getByLabel("Playhead time", { exact: true })
			.fill(
				`00:00:${String(Math.floor(frame / 30)).padStart(2, "0")}:${String(frame % 30).padStart(2, "0")}`,
			);
		await page.getByLabel("Playhead time", { exact: true }).press("Enter");
	};
	const sample = async () => {
		const value = await sampleContinuityExportPng(
			page,
			await (await mainPreviewCanvas(page)).screenshot(),
		);
		return {
			...value,
			hash: createHash("sha256").update(value.pixels).digest("hex"),
		};
	};
	onPhase("F02 import audiovisual underlay through actual media controls");
	const video = join(work, "f02-underlay.mp4");
	createRangeSource(video, { segmentSeconds: 6, secondColor: "red" });
	await page.getByLabel("Media", { exact: true }).click();
	await page.locator('input[type="file"]').setInputFiles(video);
	await page
		.getByLabel("Add f02-underlay.mp4 to timeline", { exact: true })
		.click();
	await expect(page.getByTestId("timeline-clip")).toHaveCount(1);
	for (const [index, definition] of definitions.entries()) {
		onPhase(
			"F02 form creation: " +
				definition.label +
				(index === 3 ? " mixed script" : ""),
		);
		await seek(index * 90);
		await page.getByLabel("Motion text", { exact: true }).click();
		const language = page.getByRole("combobox", {
			name: "Motion text language",
			exact: true,
		});
		await language.click();
		if (index === 1) {
			await hostPage.keyboard.press("Home");
			await hostPage.keyboard.press("ArrowDown");
			await hostPage.keyboard.press("ArrowDown");
			await hostPage.keyboard.press("Enter");
		} else
			await page
				.getByRole("option", { name: definition.label, exact: true })
				.click();
		await expect(language).toHaveText(definition.label);
		await page.locator("#motion-text-source").fill(definition.lines.join("\n"));
		await page
			.getByRole("spinbutton", { name: "Duration (seconds)", exact: true })
			.fill("3");
		await page.getByTestId("motion-text-add").click();
		await expect(page.getByTestId("timeline-clip")).toHaveCount(index + 2);
		await expect
			.poll(async () => (await read()).sequences.length)
			.toBe(index + 1);
		const sequence = (await read()).sequences[index];
		assert.equal(sequence.language, definition.language);
		assert.equal(sequence.defaults.fontId, definition.font);
		assert.deepEqual(
			sequence.cues.map((cue) => cue.text),
			definition.lines.map((line) => line.trim()),
		);
		assert(
			sequence.resolvedPlan.cuts.every((cut) => cut.fontId === definition.font),
		);
	}
	const authored = await read();
	evidence.checks.push({
		name: "F02 real form and keyboard language selection persist Japanese, Korean, English and mixed-script sequences with Rust-resolved fonts",
		pass: true,
	});
	const baselines = new Map();
	const references = new Map();
	for (const frame of Array.from({ length: 12 }, (_, i) => i * 30 + 15)) {
		onPhase("F02 exact visible baseline frame " + frame);
		await seek(frame);
		let previous,
			stable = 0,
			current;
		await expect
			.poll(
				async () => {
					current = await sample();
					stable = current.hash === previous ? stable + 1 : 1;
					previous = current.hash;
					return (
						current.foreground.length > 25 &&
						current.foreground.length < 10000 &&
						stable >= 3
					);
				},
				{ timeout: 30000 },
			)
			.toBe(true);
		await expect(
			page.getByRole("status").filter({ hasText: /missing.*required glyphs/i }),
		).toHaveCount(0);
		baselines.set(frame, current.hash);
		references.set(
			frame,
			await captureExportReference({
				page,
				hostPage,
				path: join(work, `f02-reference-${frame}.png`),
				sample: sampleContinuityExportPng,
			}),
		);
	}
	assert.equal(
		new Set(baselines.values()).size,
		12,
		"each authored phrase must render a distinct picture",
	);
	const fonts = await page.evaluate(() =>
		[...document.fonts]
			.filter((f) => f.family.startsWith("__rocut_mt_"))
			.map((f) => ({ family: f.family, status: f.status })),
	);
	for (const id of new Set(definitions.map((d) => d.font)))
		assert(
			fonts.some(
				(f) =>
					f.family.startsWith(`__rocut_mt_${id}_`) && f.status === "loaded",
			),
		);
	evidence.f02Languages = { fonts, frames: [...baselines.keys()] };
	evidence.checks.push({
		name: "F02 twelve short/long/punctuation/mixed-script phrases render distinct visible pictures with loaded local fonts and no missing-glyph warning",
		pass: true,
	});
	onPhase("F02 actual document reload and out-of-order exact picture checks");
	await page.reload();
	await expect.poll(read).toEqual(authored);
	for (const frame of [...baselines.keys()].reverse()) {
		await seek(frame);
		await expect
			.poll(async () => (await sample()).hash, { timeout: 30000 })
			.toBe(baselines.get(frame));
	}
	evidence.checks.push({
		name: "F02 all twelve multilingual pictures reproduce exactly after reload and reversed seeks",
		pass: true,
	});
	onPhase("F02 real MP4 export and independent glyph samples");
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
		const meta = JSON.parse(
			execFileSync(
				"ffprobe",
				[
					"-v",
					"error",
					"-count_frames",
					"-show_streams",
					"-of",
					"json",
					output.path,
				],
				{ encoding: "utf8", windowsHide: true },
			),
		);
		const stream = meta.streams.find((s) => s.codec_type === "video");
		assert.equal(stream.codec_name, "h264");
		assert.equal(stream.width, 1920);
		assert.equal(stream.height, 1080);
		assert.equal(Number(stream.nb_read_frames), 360);
		const scores = [];
		for (const [frame, reference] of references) {
			const png = execFileSync(
				"ffmpeg",
				[
					"-v",
					"error",
					"-ss",
					String(frame / 30),
					"-i",
					output.path,
					"-frames:v",
					"1",
					"-f",
					"image2pipe",
					"-vcodec",
					"png",
					"pipe:1",
				],
				{ windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
			);
			const actual = await sampleContinuityExportPng(page, png);
			const score = compareContinuityExport({ expected: reference, actual });
			assertContinuityExport(score);
			scores.push({ frame, ...score });
		}
		evidence.f02Languages.export = { file: output.path, frames: 360, scores };
		evidence.checks.push({
			name: "F02 actual 1080p H.264 export preserves all twelve multilingual glyph samples",
			pass: true,
		});
	} finally {
		await cdp.send("Browser.setDownloadBehavior", { behavior: "default" });
		await cdp.detach();
	}
	assert.deepEqual(await read(), authored);
}
