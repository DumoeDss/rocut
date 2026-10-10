import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { join, win32 } from "node:path";
import {
	blazeEditorDigest as digest,
	blazeEditorWrite as save,
} from "./blaze-editor-control.mjs";
import { blazeEditorDeadline } from "./blaze-editor-lifecycle.mjs";
import { canonicalBlazeEditorSource } from "./blaze-editor-export-canonical.mjs";
import { blazeEditorExportJobs } from "./blaze-editor-export-contract.mjs";
import { runBlazeEditorExportJob } from "./blaze-editor-export-jobs.mjs";
import {
	freezeBlazeExportProject,
	verifyBlazeExportProject,
	assertOnlyBlazeExportsAdded,
} from "./blaze-editor-export-persistence.mjs";

async function expectedFrames(root, snapshot) {
	const child = spawn(
		process.env.OPENCUT_BUN,
		["script/fixtures/blaze-editor-export-expected.ts", root],
		{
			cwd: snapshot,
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	let stdout = "",
		stderr = "";
	child.stdout.setEncoding("utf8").on("data", (text) => {
		stdout += text;
	});
	child.stderr.setEncoding("utf8").on("data", (text) => {
		stderr += text;
	});
	const closed = new Promise((resolve, reject) => {
		child.once("error", reject);
		child.once("close", (code, signal) => resolve({ code, signal }));
	});
	let result;
	try {
		result = await blazeEditorDeadline(
			closed,
			60000,
			"Independent Blaze CPU expected generation",
		);
	} finally {
		if (child.exitCode === null && child.signalCode === null) {
			child.kill();
			await blazeEditorDeadline(closed, 10000, "Owned CPU child close");
		}
		await save(root, "export-expected-stdout.log", stdout);
		await save(root, "export-expected-stderr.log", stderr);
	}
	assert.equal(result.code, 0, stderr || stdout);
	const report = JSON.parse(
		await readFile(join(root, "export-expected.json"), "utf8"),
	);
	assert(
		report.ok,
		"Independent canonical-source discrimination is insufficient",
	);
	return report;
}

export async function runBlazeEditorExportChecks({
	root,
	page,
	request,
	editorUrl,
	snapshot,
	evidence,
}) {
	const baseline = await freezeBlazeExportProject(root, request);
	evidence.exportBaseline = {
		revision: baseline.snapshot.revision,
		sha256: digest(baseline.bytes),
		snapshot: baseline.snapshot,
		context: baseline.context,
		files: baseline.files,
	};
	evidence.canonicalSource = await canonicalBlazeEditorSource({
		page,
		root,
		editorUrl,
	});
	evidence.independentExpected = await expectedFrames(root, snapshot);
	evidence.exportReadOnly = [
		await verifyBlazeExportProject(
			root,
			request,
			baseline,
			"after-independent-source-decode",
		),
	];
	const protocol = await request("export");
	assert.equal(protocol.surfaces, 1);
	assert.equal(protocol.protocol.version, 2);
	assert(protocol.protocol.videoChroma.includes("444"));
	evidence.exportJobs = [];
	let previousFiles = baseline.files;
	for (const spec of blazeEditorExportJobs) {
		evidence.exportReadOnly.push(
			await verifyBlazeExportProject(
				root,
				request,
				baseline,
				`before-${spec.jobKey}`,
			),
		);
		const finished = await runBlazeEditorExportJob({
			editorUrl,
			request,
			root,
			spec,
		});
		const persisted = await verifyBlazeExportProject(
			root,
			request,
			baseline,
			`after-${spec.jobKey}`,
		);
		const added = assertOnlyBlazeExportsAdded(previousFiles, persisted.files);
		assert.equal(
			added.length,
			1,
			"Each successful request must create exactly one new media file",
		);
		const outputPath = await realpath(finished.outputPath),
			exportRoot = await realpath(join(root, "project/exports"));
		assert.equal(
			win32.resolve(outputPath).toLowerCase(),
			win32.resolve(finished.outputPath).toLowerCase(),
		);
		assert.equal(win32.relative(exportRoot, outputPath), `${finished.id}.webm`);
		assert.equal(added[0].path, `exports/${finished.id}.webm`);
		const bytes = await readFile(outputPath);
		assert(bytes.length > 0);
		const filename = `${spec.jobKey}-production.webm`;
		await save(root, filename, bytes);
		evidence.exportJobs.push({
			spec,
			finished,
			media: { filename, bytes: bytes.length, sha256: digest(bytes) },
		});
		evidence.exportReadOnly.push(persisted);
		previousFiles = persisted.files;
	}
	assert.equal(
		new Set(evidence.exportJobs.map((job) => job.finished.id)).size,
		6,
	);
	evidence.exportProjectUnchanged = true;
}
