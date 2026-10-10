import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProgrammaticResource } from "@opencut/editor-contracts";
import { startHost } from "../../apps/cli/src/host";
import { TargetRegistry } from "../../apps/cli/src/target-registry";
import { assertPrivateDirectory } from "./clouds-editor-lifecycle.mjs";
import {
	editorImage,
	editorParams,
	editorSource,
} from "./droplets-editor-scene";
import { highChromaUiContract as contract } from "./high-chroma-ui-contract.mjs";

const [root, staticDir] = process.argv.slice(2);
for (const path of [root, staticDir])
	assertPrivateDirectory(path, "High-chroma UI Host input");
const options = {
	projectRoot: join(root, "project"),
	registry: new TargetRegistry(join(root, "registry")),
	htmlBrowserExecutable: "",
	htmlFrameConnectionFile: "",
	staticDir,
};
const digest = (bytes: Uint8Array) =>
	createHash("sha256").update(bytes).digest("hex");
let host = await startHost(options);
const request = async (route: string, body?: unknown) => {
	const response = await fetch(new URL(`api/${route}`, host.editorUrl), {
		signal: AbortSignal.timeout(15000),
		...(body === undefined
			? {}
			: { method: "POST", body: JSON.stringify(body) }),
	});
	const value = await response.json();
	assert.equal(response.status, 200, JSON.stringify(value));
	return value;
};
const byId = <T extends { id: string }>(items: readonly T[]) =>
	[...items].sort((a, b) => a.id.localeCompare(b.id));
const snapshot = async () => ({
	clips: byId(await host.automation.clips()),
	tracks: byId(await host.automation.tracks()),
	revision: await host.automation.revision(),
});
try {
	const author = join(root, "author");
	await mkdir(author);
	const png = editorImage();
	const filePath = join(author, "droplets.png");
	await writeFile(filePath, png, { flag: "wx" });
	const { resource } = (await request("programmatic/resources/import", {
		id: "droplets.png",
		filePath,
		kind: "image",
		mimeType: "image/png",
	})) as { resource: ProgrammaticResource };
	assert.equal(resource.sha256, digest(png));
	const source = editorSource(resource);
	const context = await request("context");
	await request("apply", {
		expectedRevision: context.revision,
		operations: [
			{
				kind: "update-project",
				projectId: context.project.id,
				patch: {
					name: contract.projectName,
					canvasWidth: contract.width,
					canvasHeight: contract.height,
					frameRate: { numerator: contract.fps, denominator: 1 },
					background: { type: "color", color: "#203040" },
				},
			},
			{
				kind: "create-track",
				track: {
					id: "chroma-shots",
					kind: "graphic",
					name: "Six frames",
					hidden: false,
				},
			},
			{
				kind: "create-clip",
				clip: {
					id: contract.clipId,
					trackId: "chroma-shots",
					startTime: 0,
					duration: contract.durationTicks,
					trimStart: 0,
					trimEnd: 0,
					editing: {
						type: "graphic",
						name: "Droplets UI export transport",
						definitionId: "programmatic",
						params: {},
						programmatic: source,
						effects: [
							{
								id: "water",
								type: "droplets",
								enabled: true,
								params: editorParams,
							},
						],
					},
				},
			},
		],
	});
	await rename(author, join(root, "unavailable-author"));
	const expected = await snapshot();
	await host.close();
	host = await startHost(options);
	assert.deepEqual(await snapshot(), expected);
	await writeFile(
		join(root, "project-before-ui.json"),
		await readFile(join(options.projectRoot, "project.json")),
		{ flag: "wx" },
	);
	await writeFile(
		join(root, "prepared.json"),
		JSON.stringify(
			{
				ok: true,
				contract,
				...expected,
				resource,
				imageSha256: digest(png),
				hostReopened: true,
				authorUnavailable: true,
				historicalProjectModified: false,
			},
			null,
			2,
		),
		{ flag: "wx" },
	);
	console.log(JSON.stringify({ editorUrl: host.editorUrl }));
	await new Promise<void>((done) => {
		process.stdin.once("data", () => done());
		process.stdin.once("end", () => done());
		process.once("SIGTERM", () => done());
	});
	assert.deepEqual(await snapshot(), expected);
	await host.close();
	host = await startHost(options);
	assert.deepEqual(await snapshot(), expected);
	const afterRestart = await readFile(
		join(options.projectRoot, "project.json"),
	);
	const beforeExport = await readFile(join(root, "project-before-export.json"));
	assert(
		afterRestart.equals(beforeExport),
		"Session close/restart changed project bytes",
	);
	await writeFile(
		join(root, "closed.json"),
		JSON.stringify({
			ok: true,
			hostReopenedAfterSession: true,
			projectBytesUnchangedOnClose: true,
			projectSha256: digest(afterRestart),
		}),
		{ flag: "wx" },
	);
} finally {
	await host.close();
}
