import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { downloadUiExport } from "./probe-ui-export-fixture.mjs";
import {
	samplePreviewPng,
	languageOverlap,
} from "./probe-multilingual-media.mjs";
import { inspectF03, assertF03 } from "./probe-f03-pixels.mjs";

export function compareF03Export(expected, actual) {
	assertF03(expected);
	assertF03(actual);
	return expected.regions.map((pixels, index) =>
		languageOverlap({ expected: pixels, actual: actual.regions[index] }),
	);
}

export function assertF03Export(overlaps) {
	assert.equal(overlaps.length, 3);
	assert(
		overlaps.every((value) => value > 0.7),
		"each exported language must match its own preview: " + overlaps,
	);
}

export async function probeF03Export({
	page,
	hostPage,
	work,
	references,
	authored,
	evidence,
	onPhase,
}) {
	onPhase("F03 actual simultaneous three-language MP4 export");
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
		assert.equal(meta.streams.length, 1);
		const stream = meta.streams[0];
		assert.equal(stream.codec_name, "h264");
		assert.equal(stream.width, 1920);
		assert.equal(stream.height, 1080);
		const frames = Math.ceil(
			Math.max(...authored.clips.map((c) => c.startTime + c.duration)) / 4000,
		);
		assert.equal(Number(stream.nb_read_frames), frames);
		const samples = [];
		evidence.f03Export = { file: output.path, frames, samples };
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
			writeFileSync(join(work, `f03-export-${frame}.png`), png);
			const actual = await samplePreviewPng(page, png, inspectF03);
			const overlaps = compareF03Export(reference, actual);
			samples.push({ frame, overlaps });
			assertF03Export(overlaps);
		}
		evidence.checks.push({
			name: "F03 real 1080p H.264 export independently preserves all three simultaneous language glyph masks",
			pass: true,
		});
	} finally {
		await cdp.send("Browser.setDownloadBehavior", { behavior: "default" });
		await cdp.detach();
	}
}
