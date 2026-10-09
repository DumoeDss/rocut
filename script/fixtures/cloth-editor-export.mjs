import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { capture, poll, seek } from "./stylized-fusion-checks.mjs";
import { decodeSweepScrollEditor } from "./sweep-scroll-editor-decode.mjs";

export async function finishClothEditor(
	page,
	artifacts,
	evidence,
	agentRequest,
	prepared,
) {
	const byId = (items) => [...items].sort((a, b) => a.id.localeCompare(b.id));
	const clips = byId(await agentRequest("clips"));
	const saved = await poll(async () => {
		const disk = JSON.parse(
			await readFile(join(artifacts, "project/project.json"), "utf8"),
		);
		return isDeepStrictEqual(disk.record, (await agentRequest("record")).record)
			? disk
			: null;
	});
	assert.equal(saved.wrapperVersion, 1);
	await page.reload({ waitUntil: "commit" });
	await page
		.getByRole("button", { name: "Edit playhead time", exact: true })
		.waitFor();
	for (const edit of evidence.clothEdits)
		for (const sample of edit.samples) {
			await seek(
				page,
				Math.floor(sample.timelineTicks / 120000),
				(sample.timelineTicks % 120000) / 4000,
			);
			await capture(
				page,
				artifacts,
				`cloth-reopened-${edit.index}-${sample.localTicks}`,
				sample.sha256,
			);
		}
	assert.deepEqual(byId(await agentRequest("clips")), clips);
	const context = await agentRequest("context"),
		tracks = await agentRequest("tracks");
	await writeFile(
		join(artifacts, "expected-edited.json"),
		JSON.stringify(
			{
				revision: context.revision,
				clips,
				tracks: byId(tracks),
				authoredTrackIds: tracks
					.filter((track) => prepared.authoredTrackIds.includes(track.id))
					.map((track) => track.id),
			},
			null,
			2,
		),
		{ flag: "wx" },
	);
	evidence.checks.push({
		name: "disk save and editor reload preserve full Cloth sources, unrelated clips and four edited preview samples",
		pass: true,
	});
	const started = await agentRequest("export", {
		format: "webm",
		quality: "very_high",
		includeAudio: false,
	});
	let previous = -1;
	const finished = await poll(async () => {
		const job = await agentRequest(`export/${started.id}`),
			progress = Math.floor(job.progress * 10);
		if (progress !== previous) {
			previous = progress;
			console.log(
				JSON.stringify({
					phase: "cloth-export",
					progress: job.progress,
					status: job.status,
				}),
			);
		}
		return ["completed", "failed", "cancelled"].includes(job.status)
			? job
			: null;
	}, 300000);
	assert.equal(finished.status, "completed", finished.error);
	const inside = relative(
		join(artifacts, "project/exports"),
		finished.outputPath,
	);
	assert(inside && !inside.startsWith("..") && !isAbsolute(inside));
	evidence.export = finished;
	evidence.decoded = decodeSweepScrollEditor(
		finished.outputPath,
		artifacts,
		process.env.ROCUT_FUSION_FFMPEG_DIR,
		evidence.clothEdits,
		{ count: 2, finalBackground: false },
	);
	assert.deepEqual(byId(await agentRequest("clips")), clips);
	evidence.checks.push({
		name: "120-frame four-second VP9 export independently decoded against four edited preview samples",
		pass: true,
	});
}
