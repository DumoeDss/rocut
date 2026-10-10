import assert from "node:assert/strict";
import {
	blazeEditorPoll,
	blazeEditorWrite as save,
} from "./blaze-editor-control.mjs";

export async function runBlazeEditorExportJob({
	editorUrl,
	request,
	root,
	spec,
}) {
	const observations = [];
	const response = await fetch(new URL("api/export", editorUrl), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(spec.options),
		signal: AbortSignal.timeout(15000),
	});
	const started = await response.json();
	await save(root, `${spec.jobKey}-request.json`, {
		options: spec.options,
		status: response.status,
		body: started,
	});
	assert.equal(response.status, 202, JSON.stringify(started));
	assert(typeof started.id === "string" && /^[a-zA-Z0-9_-]+$/.test(started.id));
	const validate = (job) => {
		observations.push(job);
		assert.equal(job.id, started.id);
		assert.deepEqual(
			job.options,
			spec.options,
			"Export option or chroma changed",
		);
		assert(
			["pending", "running", "completed", "failed", "cancelled"].includes(
				job.status,
			),
		);
		return ["pending", "running"].includes(job.status) ? null : job;
	};
	try {
		const finished =
			validate(started) ??
			(await blazeEditorPoll(
				async () => validate(await request(`export/${started.id}`)),
				90000,
			));
		assert.equal(finished.status, "completed", JSON.stringify(finished));
		assert.equal(finished.error, undefined);
		assert.equal(finished.cancelRequested, false);
		assert.equal(finished.progress, 1);
		assert(
			typeof finished.outputPath === "string" && finished.outputPath.length > 0,
		);
		return finished;
	} finally {
		await save(root, `${spec.jobKey}-observations.json`, observations);
	}
}
