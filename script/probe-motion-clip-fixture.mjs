import assert from "node:assert/strict";
import {
	sampleContinuityExportPng,
	compareContinuityExport,
	assertContinuityExport,
} from "./probe-continuity-export-pixels.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { languageOverlap } from "./probe-multilingual-media.mjs";
import { downloadUiExport } from "./probe-ui-export-fixture.mjs";

export async function createMotionContinuityFixture({ page, hostPage, work }) {
	await page.getByLabel("Motion text", { exact: true }).click();
	const source = JSON.parse(
		readFileSync(
			new URL(
				"../rust/crates/motion-text/fixtures/jizura-v1-project.json",
				import.meta.url,
			),
			"utf8",
		),
	);
	source.colors = {
		enabled: true,
		accentOn: true,
		fg: "#00FFFF",
		accent: "#00FFFF",
	};
	source.overrides = Object.fromEntries(
		source.lyrics.split("\n").map((text, index) => [
			index,
			{
				lock: true,
				lockedCuts: [
					{
						utext: text,
						layout: "huge",
						enter: "pop",
						hold: "pulse",
						exit: "shrink",
						seed: 24000 + index,
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
		name: "continuity.jizura.json",
		mimeType: "application/json",
		buffer: Buffer.from(JSON.stringify(source)),
	});
	await expect(page.getByTestId("timeline-clip")).toHaveCount(1);
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
	await page.getByLabel("Media", { exact: true }).click();
	await page.locator('input[type="file"]').setInputFiles(video);
	await page
		.getByLabel("Add continuity-underlay.mp4 to timeline", { exact: true })
		.click();
	await expect(page.getByTestId("timeline-clip")).toHaveCount(2);
}

export async function exportMotionContinuity({
	page,
	hostPage,
	work,
	frames,
	offset,
	baselines,
	readState,
	split,
	check,
}) {
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
		const metadata = JSON.parse(
			execFileSync(
				"ffprobe",
				[
					"-v",
					"error",
					"-count_frames",
					"-show_streams",
					"-show_format",
					"-of",
					"json",
					output.path,
				],
				{ encoding: "utf8", windowsHide: true },
			),
		);
		assert(metadata.streams.some((s) => s.codec_type === "audio"));
		assert.equal(
			Number(
				metadata.streams.find((s) => s.codec_type === "video").nb_read_frames,
			),
			240,
		);
		const decode = async (frame) => {
			assert(Number.isInteger(frame) && frame >= 0);
			const png = execFileSync(
				"ffmpeg",
				[
					"-v",
					"error",
					"-i",
					output.path,
					"-vf",
					"select=eq(n\\," + frame + ")",
					"-frames:v",
					"1",
					"-f",
					"image2pipe",
					"-vcodec",
					"png",
					"pipe:1",
				],
				{ windowsHide: true },
			);
			writeFileSync(
				join(work, "continuity-export-frame-" + frame + ".png"),
				png,
			);
			return sampleContinuityExportPng(hostPage, png);
		};
		const empty = await decode(0);
		assert.equal(
			empty.foreground.length,
			0,
			"export frame zero must be an independent no-text negative control",
		);
		const wrong = await decode(frames[0] + offset);
		const wrongFrameOverlap = languageOverlap({
			expected: baselines.get(frames[frames.length - 1]).foreground,
			actual: wrong.foreground,
		});
		assert(
			wrongFrameOverlap <= 0.7,
			"wrong animation phase must fail the same glyph-overlap gate",
		);
		check(
			"decoded empty and wrong-phase frames fail the 0.7 export overlay gate",
			{ emptyPixels: empty.foreground.length, wrongFrameOverlap },
		);
		const overlaps = [];
		for (const frame of frames) {
			const actual = await decode(frame + offset);
			const scores = compareContinuityExport({
				expected: baselines.get(frame),
				actual,
			});
			overlaps.push({
				sourceFrame: frame,
				outputFrame: frame + offset,
				...scores,
			});
			writeFileSync(
				join(work, "continuity-export-samples.json"),
				JSON.stringify(overlaps, null, 2),
			);
			assertContinuityExport(scores);
		}
		const audioRms = (path, channel) => {
			// Select a channel, do not downmix stereo with ffmpeg's sqrt(2) gain.
			const audio = execFileSync(
				"ffmpeg",
				[
					"-v",
					"error",
					"-i",
					path,
					"-vn",
					"-af",
					"pan=mono|c0=c" + channel,
					"-ar",
					"8000",
					"-f",
					"f32le",
					"pipe:1",
				],
				{ windowsHide: true },
			);
			let sum = 0;
			for (let i = 0; i < audio.length; i += 4)
				sum += audio.readFloatLE(i) ** 2;
			return Math.sqrt(sum / (audio.length / 4));
		};
		const sourceRms = audioRms(join(work, "continuity-underlay.mp4"), 0);
		const rms = [audioRms(output.path, 0), audioRms(output.path, 1)];
		assert(
			sourceRms > 0.07 && sourceRms < 0.11,
			"source fixture must be audible",
		);
		assert(
			rms.every(
				(value) => value / sourceRms > 0.95 && value / sourceRms < 1.05,
			),
			"each exported channel must preserve original gain",
		);
		assert.deepEqual(await readState(), split);
		check(
			"actual MP4 export preserves all five source-time glyph regions and real audio after move trim split",
			{ frames: 240, overlaps, sourceRms, rms, output: output.path },
		);
	} finally {
		await cdp.send("Browser.setDownloadBehavior", { behavior: "default" });
		await cdp.detach();
	}
}
