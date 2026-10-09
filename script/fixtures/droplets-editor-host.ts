import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { ProgrammaticResource } from "@opencut/editor-contracts";
import { startHost } from "../../apps/cli/src/host";
import { TargetRegistry } from "../../apps/cli/src/target-registry";
import {
	editorChanges,
	editorImage,
	editorParams,
	editorSource,
	opticalChannels,
} from "./droplets-editor-scene";

const [root, staticDir] = process.argv.slice(2);
assert([root, staticDir].every((value) => value && isAbsolute(value)));
const inside = relative(resolve("C:/tmps"), resolve(root));
assert(inside && !inside.startsWith("..") && !isAbsolute(inside));
const options = {
	projectRoot: join(root, "project"),
	registry: new TargetRegistry(join(root, "registry")),
	htmlBrowserExecutable: "",
	htmlFrameConnectionFile: "",
	staticDir,
};
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
const authoredTrackIds = ["droplets-shots", "droplets-sentinel"];
const snapshot = async () => ({
	clips: byId(await host.automation.clips()),
	tracks: byId(await host.automation.tracks()),
	revision: await host.automation.revision(),
	authoredTrackIds: (await host.automation.tracks())
		.filter((track) => authoredTrackIds.includes(track.id))
		.map((track) => track.id),
});
const digest = (bytes: Uint8Array) =>
	createHash("sha256").update(bytes).digest("hex");
try {
	const author = join(root, "author");
	await mkdir(author);
	const png = editorImage(),
		filePath = join(author, "droplets.png");
	await writeFile(filePath, png, { flag: "wx" });
	const { resource } = (await request("programmatic/resources/import", {
		id: "droplets.png",
		filePath,
		kind: "image",
		mimeType: "image/png",
	})) as { resource: ProgrammaticResource };
	assert.equal(resource.sha256, digest(png));
	const source = editorSource(resource);
	const animations = Object.fromEntries(
		Object.entries(opticalChannels).map(([key, values]) => [
			`effects.water.params.${key}`,
			{
				keys: values.map((value, index) => ({
					id: `${key}-${index}`,
					time: index * 24000,
					value,
					segmentToNext: "linear",
					tangentMode: "auto",
				})),
			},
		]),
	);
	const shots = [0, 1].map((index) => ({
		id: `droplets-${index}`,
		trackId: "droplets-shots",
		startTime: index * 120000,
		duration: 120000,
		trimStart: 0,
		trimEnd: 0,
		editing: {
			type: "graphic",
			name: index ? "Three optical channels" : "Static Droplets controls",
			definitionId: "programmatic",
			params: {},
			programmatic: source,
			effects: [
				{ id: "water", type: "droplets", enabled: true, params: editorParams },
			],
			...(index ? { animations } : {}),
		},
	}));
	const staticReferences = [4000, 12000, 24000].map((local, index) => ({
		...shots[0],
		id: `droplets-reference-${local}`,
		startTime: (index + 2) * 120000,
		editing: {
			...shots[0].editing,
			name: `Static optical reference ${local}`,
			effects: [
				{
					id: "water",
					type: "droplets",
					enabled: true,
					params: {
						...editorParams,
						...Object.fromEntries(
							Object.entries(opticalChannels).map(([key, values]) => [
								key,
								values[0] + ((values[1] - values[0]) * local) / 24000,
							]),
						),
					},
				},
			],
		},
	}));
	const baseline = {
		...shots[0],
		id: "droplets-baseline",
		startTime: 600000,
		editing: {
			...shots[0].editing,
			name: "Unfiltered imported image baseline",
			effects: [],
		},
	};
	const context = await request("context");
	await request("apply", {
		expectedRevision: context.revision,
		operations: [
			{
				kind: "update-project",
				projectId: context.project.id,
				patch: {
					name: "Droplets real editor acceptance",
					canvasWidth: 640,
					canvasHeight: 360,
					frameRate: { numerator: 30, denominator: 1 },
					background: { type: "color", color: "#203040" },
				},
			},
			...authoredTrackIds.map((id, index) => ({
				kind: "create-track",
				track: {
					id,
					kind: "graphic",
					name: index ? "Unrelated hidden sentinel" : "Droplets shots",
					hidden: index === 1,
				},
			})),
			...[...shots, ...staticReferences, baseline].map((clip) => ({
				kind: "create-clip",
				clip,
			})),
			{
				kind: "create-clip",
				clip: {
					...baseline,
					id: "droplets-unrelated",
					trackId: "droplets-sentinel",
					startTime: 0,
					editing: {
						...baseline.editing,
						name: "Untouched source",
						params: { opacity: 0.7 },
					},
				},
			},
		],
	});
	await rename(author, join(root, "unavailable-author"));
	const verifyResource = async () => {
		const response = await fetch(
			new URL("api/programmatic/resources/load", host.editorUrl),
			{
				method: "POST",
				body: JSON.stringify(resource),
				signal: AbortSignal.timeout(15000),
			},
		);
		assert.equal(response.status, 200);
		assert.equal(
			digest(new Uint8Array(await response.arrayBuffer())),
			digest(png),
		);
	};
	const before = await snapshot();
	await host.close();
	host = await startHost(options);
	assert.deepEqual(await snapshot(), before);
	await verifyResource();
	await writeFile(
		join(root, "prepared.json"),
		JSON.stringify(
			{
				ok: true,
				hostReopened: true,
				...before,
				resource,
				source,
				imageSha256: digest(png),
				authorUnavailable: true,
				optical: opticalChannels,
				changes: editorChanges,
				sampleLocalTicks: [4000, 12000, 24000],
				baselineTicks: 604000,
				authoring:
					"Real Host resource import and optical keyframes; actual editor Effects UI and attached-session history",
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
	let expected;
	try {
		expected = JSON.parse(
			await readFile(join(root, "expected-edited.json"), "utf8"),
		);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	if (expected) {
		await host.close();
		host = await startHost(options);
		assert.deepEqual(await snapshot(), expected);
		await verifyResource();
		await writeFile(
			join(root, "reopened-after-edit.json"),
			JSON.stringify(
				{
					ok: true,
					hostReopenedAfterEdits: true,
					resourceStillAvailable: true,
					...(await snapshot()),
				},
				null,
				2,
			),
			{ flag: "wx" },
		);
	}
} finally {
	await host.close();
}
