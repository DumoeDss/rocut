import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const toolchain = process.argv[2];
const previewMode = process.argv[3];
if (previewMode !== undefined && previewMode !== "--routed-preview")
	throw Error("Unknown collector probe option");
if (!toolchain)
	throw Error(
		"Usage: node script/probe-hyperframes-audio-graph-collector.mjs <isolated-toolchain-directory> [--routed-preview]",
	);
const parent = resolve(tmpdir());
const staging = await mkdtemp(join(parent, "rocut-hf-graph-collector-"));
let passed = false;
try {
	await new Promise((done, reject) => {
		const child = spawn(
			"bun",
			[
				"script/fixtures/hyperframes-audio-graph-collector.ts",
				resolve(toolchain),
				staging,
				...(previewMode ? [previewMode] : []),
			],
			{
				cwd: root,
				windowsHide: true,
				stdio: "inherit",
			},
		);
		const timeout = setTimeout(() => {
			child.kill();
			reject(Error("Collector fixture exceeded its 90-second process limit"));
		}, 90000);
		child.once("error", (error) => {
			clearTimeout(timeout);
			reject(error);
		});
		child.once("close", (code) => {
			clearTimeout(timeout);
			if (code === 0) done();
			else reject(Error(`Collector fixture exited ${code}`));
		});
	});
	passed = true;
} finally {
	if (passed) {
		if (
			dirname(staging) !== parent ||
			!basename(staging).startsWith("rocut-hf-graph-collector-")
		)
			throw Error("Unsafe collector fixture cleanup");
		await rm(staging, { recursive: true, force: true });
	} else {
		console.error(`Collector failure artifacts retained: ${staging}`);
	}
}
