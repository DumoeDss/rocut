import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { startHost } from "../../apps/cli/src/host";
import { TargetRegistry } from "../../apps/cli/src/target-registry";
import { assertPrivateDirectory } from "./clouds-editor-lifecycle.mjs";

const [root, staticDir, sourceRun] = process.argv.slice(2);
assert(
	[root, staticDir, sourceRun].every((value) => value && isAbsolute(value)),
);
for (const path of [root, staticDir, sourceRun])
	assertPrivateDirectory(path, "Clouds export Host input");
const accepted = JSON.parse(
	await readFile(join(sourceRun, "evidence.json"), "utf8"),
);
assert(accepted.ok && accepted.hostRestart.hostReopenedAfterEdits);
const expected = JSON.parse(
	await readFile(join(sourceRun, "expected-edited.json"), "utf8"),
);
const options = {
	projectRoot: join(sourceRun, "project"),
	registry: new TargetRegistry(join(root, "registry")),
	htmlBrowserExecutable: "",
	htmlFrameConnectionFile: "",
	staticDir,
};
const byId = <T extends { id: string }>(items: readonly T[]) =>
	[...items].sort((a, b) => a.id.localeCompare(b.id));
let host = await startHost(options);
const snapshot = async () => ({
	clips: byId(await host.automation.clips()),
	tracks: byId(await host.automation.tracks()),
	revision: await host.automation.revision(),
	authoredTrackIds: (await host.automation.tracks())
		.filter((track) => expected.authoredTrackIds.includes(track.id))
		.map((track) => track.id),
});
const projectSha256 = async () =>
	createHash("sha256")
		.update(await readFile(join(options.projectRoot, "project.json")))
		.digest("hex");
try {
	assert.deepEqual(await snapshot(), expected);
	const beforeHash = await projectSha256();
	await writeFile(
		join(root, "project-before-ui.json"),
		await readFile(join(options.projectRoot, "project.json")),
		{ flag: "wx" },
	);
	await writeFile(
		join(root, "reopened-for-export.json"),
		JSON.stringify(
			{
				ok: true,
				sourceRun,
				projectSha256: beforeHash,
				...expected,
			},
			null,
			2,
		),
		{ flag: "wx" },
	);
	console.log(JSON.stringify({ editorUrl: host.editorUrl }));
	await new Promise<void>((resolve) => {
		process.stdin.once("data", () => resolve());
		process.stdin.once("end", () => resolve());
		process.once("SIGTERM", () => resolve());
	});
	assert.deepEqual(await snapshot(), expected);
	await host.close();
	const afterClose = await readFile(join(options.projectRoot, "project.json"));
	await writeFile(join(root, "project-after-close.json"), afterClose, {
		flag: "wx",
	});
	host = await startHost(options);
	assert.deepEqual(await snapshot(), expected);
	const afterReopen = await readFile(join(options.projectRoot, "project.json"));
	await writeFile(join(root, "project-after-reopen.json"), afterReopen, {
		flag: "wx",
	});
	const exportBaseline = await readFile(
		join(root, "project-before-export.json"),
	);
	assert(
		afterClose.equals(exportBaseline),
		"Project bytes changed after export baseline",
	);
	assert(
		afterReopen.equals(exportBaseline),
		"Project bytes changed after restart",
	);
	await writeFile(
		join(root, "reopened-after-edit.json"),
		JSON.stringify(
			{
				ok: true,
				hostReopenedAfterExport: true,
				sourceRun,
				initialProjectSha256: beforeHash,
				projectSha256: await projectSha256(),
				projectBytesUnchangedByExport: true,
				identicalProjectByteStages: [
					"before-export",
					"after-export",
					"after-close",
					"after-reopen",
				],
				...(await snapshot()),
			},
			null,
			2,
		),
		{ flag: "wx" },
	);
} finally {
	await host.close();
}
