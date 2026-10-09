import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	hash,
	nativeCommand,
	writeJson,
} from "../particle-c4-export-support.mjs";
import {
	EDITOR_EXPORT_CONTRACT as contract,
	assertUiGeometry,
} from "./particle-editor-export-contract.mjs";
import {
	acceptsProjectPixels,
	projectPixelMetrics,
} from "./particle-project-export-pixels.mjs";

export async function verifyEditorExport({ root, ffmpeg, ffprobe, handoff }) {
	const video = join(root, "particle.webm"),
		failures = [];
	const result = {
		contract,
		scope: contract.coverage,
		metadata: null,
		fullDecode: null,
		selectedDecode: null,
		frames: [],
		uiReferenceDecodes: [],
		failures,
	};
	try {
		const probe = await nativeCommand(
			ffprobe,
			[
				"-v",
				"error",
				"-select_streams",
				"v:0",
				"-count_frames",
				"-show_entries",
				"stream=codec_name,width,height,r_frame_rate,avg_frame_rate,nb_read_frames:format=duration:frame=best_effort_timestamp_time",
				"-of",
				"json",
				video,
			],
			root,
			"ffprobe",
		);
		result.metadata = JSON.parse(probe.output);
		result.ffprobeLifecycle = probe.lifecycle;
		assert.equal(result.metadata.streams.length, 1);
		const stream = result.metadata.streams[0];
		assert.equal(stream.width, 1920);
		assert.equal(stream.height, 1080);
		assert.equal(Number(stream.nb_read_frames), 121);
		for (const key of ["r_frame_rate", "avg_frame_rate"]) {
			const [n, d] = stream[key].split("/").map(Number);
			assert.ok(d > 0 && n / d === 30);
		}
		assert.ok(
			Math.abs(Number(result.metadata.format.duration) - 121 / 30) <=
				0.001 + Number.EPSILON,
		);
		assert.equal(result.metadata.frames.length, 121);
		result.timestamps = result.metadata.frames.map((frame, index) => {
			const actual = Number(frame.best_effort_timestamp_time),
				expected = index / 30;
			assert.ok(
				Number.isFinite(actual) &&
					Math.abs(actual - expected) <=
						contract.limits.timestampToleranceSeconds + Number.EPSILON,
				`Unexpected full-duration timestamp ${index}`,
			);
			return {
				index,
				ticks: index * 4000,
				expectedSeconds: expected,
				actualSeconds: actual,
			};
		});
		const full = await nativeCommand(
			ffmpeg,
			[
				"-v",
				"error",
				"-nostdin",
				"-xerror",
				"-err_detect",
				"explode",
				"-i",
				video,
				"-map",
				"0:v:0",
				"-an",
				"-progress",
				"pipe:1",
				"-nostats",
				"-f",
				"null",
				"-",
			],
			root,
			"ffmpeg-all-frames-null",
		);
		const counts = [...full.output.matchAll(/^frame=(\d+)\s*$/gm)].map(
			(match) => Number(match[1]),
		);
		assert.equal(
			counts.at(-1),
			121,
			"Independent full decode must report every frame",
		);
		result.fullDecode = {
			frames: counts.at(-1),
			allFramesDecoded: true,
			rawPixelsPersisted: false,
			lifecycle: full.lifecycle,
		};
		const dimensions = assertUiGeometry(handoff.previewReferences.samples[0]);
		const frameBytes = dimensions.width * dimensions.height * 4;
		const selection = contract.frames
			.map((frame) => `eq(n\\,${frame})`)
			.join("+");
		const scaled = join(root, "selected-ui-geometry.rgba");
		const selected = await nativeCommand(
			ffmpeg,
			[
				"-v",
				"error",
				"-nostdin",
				"-n",
				"-i",
				video,
				"-map",
				"0:v:0",
				"-an",
				"-vf",
				`select=${selection},scale=${dimensions.width}:${dimensions.height}:flags=bilinear`,
				"-fps_mode",
				"passthrough",
				"-f",
				"rawvideo",
				"-pix_fmt",
				"rgba",
				scaled,
			],
			root,
			"ffmpeg-selected-ui-geometry",
		);
		const selectedBytes = await readFile(scaled);
		assert.equal(selectedBytes.length, frameBytes * contract.frames.length);
		result.selectedDecode = {
			...dimensions,
			frames: contract.frames,
			bytes: selectedBytes.length,
			sha256: hash(selectedBytes),
			lifecycle: selected.lifecycle,
			resampling: contract.geometry.method,
		};
		for (const [index, sample] of handoff.previewReferences.samples.entries()) {
			assert.deepEqual(assertUiGeometry(sample), dimensions);
			const referenceFile = join(root, "ui", `visible-${sample.frame}.png`);
			const raw = join(root, `ui-visible-${sample.frame}.rgba`);
			const decoded = await nativeCommand(
				ffmpeg,
				[
					"-v",
					"error",
					"-nostdin",
					"-n",
					"-i",
					referenceFile,
					"-frames:v",
					"1",
					"-f",
					"rawvideo",
					"-pix_fmt",
					"rgba",
					raw,
				],
				root,
				`ffmpeg-ui-${sample.frame}`,
			);
			const ui = await readFile(raw);
			assert.equal(ui.length, frameBytes);
			for (let offset = 3; offset < ui.length; offset += 4)
				assert.equal(
					ui[offset],
					255,
					"Actual visible UI screenshot must be opaque",
				);
			const metrics = projectPixelMetrics(
				selectedBytes.subarray(index * frameBytes, (index + 1) * frameBytes),
				ui,
			);
			const accepted = acceptsProjectPixels(metrics, true);
			result.frames.push({
				frame: sample.frame,
				ticks: sample.ticks,
				revision: sample.revision,
				uiScreenshotSha256: sample.visible.sha256,
				geometry: sample.geometry,
				...metrics,
				accepted,
			});
			result.uiReferenceDecodes.push({
				frame: sample.frame,
				kind: "actual-visible-UI",
				sha256: hash(ui),
				lifecycle: decoded.lifecycle,
			});
			if (!accepted)
				failures.push(`Real UI comparison rejected frame ${sample.frame}`);
			if (sample.backing.status === "captured") {
				const backingRaw = join(
					root,
					`ui-backing-normalized-${sample.frame}.rgba`,
				);
				const backingDecode = await nativeCommand(
					ffmpeg,
					[
						"-v",
						"error",
						"-nostdin",
						"-n",
						"-i",
						join(root, "ui", `backing-${sample.frame}.png`),
						"-vf",
						`scale=${dimensions.width}:${dimensions.height}:flags=bilinear`,
						"-frames:v",
						"1",
						"-f",
						"rawvideo",
						"-pix_fmt",
						"rgba",
						backingRaw,
					],
					root,
					`ffmpeg-ui-backing-${sample.frame}`,
				);
				const bytes = await readFile(backingRaw);
				assert.equal(bytes.length, frameBytes);
				const backingMetrics = projectPixelMetrics(bytes, ui);
				const backingAccepted = acceptsProjectPixels(backingMetrics, true);
				result.uiReferenceDecodes.push({
					frame: sample.frame,
					kind: "actual-UI-backing-downsampled-vs-visible",
					...backingMetrics,
					accepted: backingAccepted,
					sha256: hash(bytes),
					lifecycle: backingDecode.lifecycle,
				});
				if (!backingAccepted)
					failures.push(
						`Captured UI backing disagrees with visible screenshot ${sample.frame}`,
					);
			}
		}
	} catch (error) {
		failures.push(String(error));
	}
	result.status = failures.length ? "failed" : "passed";
	await writeJson(join(root, "decode-ui-verification.json"), result);
	assert.deepEqual(
		failures,
		[],
		"Full decode or actual UI reference comparison failed; thresholds unchanged and artifacts retained",
	);
	return result;
}
