import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import type {
	ProgrammaticResource,
	ProgrammaticSource,
} from "@opencut/editor-contracts";
import { startHost } from "../../apps/cli/src/host";
import { TargetRegistry } from "../../apps/cli/src/target-registry";
import { fusionImage } from "./stylized-fusion-assets";

const [root, templateDirectory] = process.argv.slice(2);
assert([root, templateDirectory].every((p) => p && isAbsolute(p)));
if (process.platform === "win32") assert(/^E:/i.test(root));
const input = join(root, "input");
await mkdir(input);
for (const [name, variant] of [
	["logo.png", "logo"],
	["texture.png", "red"],
] as const)
	await writeFile(join(input, name), fusionImage(variant), { flag: "wx" });
const templates = await import(
	pathToFileURL(join(templateDirectory, "templates.mjs")).href
);
assert.equal(typeof templates.shatterImage, "function");
const options = {
	projectRoot: join(root, "project"),
	registry: new TargetRegistry(join(root, "registry")),
	htmlBrowserExecutable: "",
	htmlFrameConnectionFile: "",
	staticDir:
		process.env.ROCUT_FUSION_EDITOR_DIST || join(root, "temp/editor-dist"),
};
let host = await startHost(options);
const post = async (route: string, body: unknown) => {
	const response = await fetch(new URL(`api/${route}`, host.editorUrl), {
		method: "POST",
		body: JSON.stringify(body),
	});
	const value = await response.json();
	assert.equal(response.status, 200, JSON.stringify(value));
	return value;
};
const get = async (route: string) =>
	(await fetch(new URL(`api/${route}`, host.editorUrl))).json();
const byId = <T extends { id: string }>(items: readonly T[]) =>
	[...items].sort((a, b) => a.id.localeCompare(b.id));
const authoredTrackIds = ["shatter-shots", "shatter-unrelated-track"];
try {
	const resources: ProgrammaticResource[] = [];
	for (const id of ["logo.png", "texture.png"])
		resources.push(
			(
				await post("programmatic/resources/import", {
					id,
					kind: "image",
					mimeType: "image/png",
					filePath: join(input, id),
				})
			).resource,
		);
	const span = { startFrame: 3, durationFrames: 54 };
	const settings = { width: 640, height: 360, durationFrames: 60, seed: 37 };
	const variants = [
		{ name: "Transparent Shatter", spread: 0.35, refraction: 0.025, seed: 37 },
		{ name: "Refractive Shatter", spread: 0.3, refraction: 0.065, seed: 53 },
	];
	const shots: { source: ProgrammaticSource; effects: unknown[] }[] =
		variants.map((variant, index) =>
			templates.shatterImage({
				image: resources[index],
				settings: { ...settings, seed: variant.seed },
				span,
				shatter: {
					fragments: 48,
					center: [0.4, 0.55],
					spread: variant.spread,
					spin: 2.7,
					gravity: 0.18,
					depth: 0.4,
					perspective: 0.6,
					refraction: variant.refraction,
					shading: 0.4,
					shadow: 0.35,
					opacity: 0.85,
					rect: [0.1, 0.1, 0.8, 0.8],
					fit: "contain",
				},
			}),
		);
	for (const [index, shot] of shots.entries()) {
		assert.equal(shot.source.durationFrames, 60);
		assert.equal(shot.source.seed, variants[index].seed);
		assert.deepEqual(shot.source.resources, [resources[index]]);
		const scene = shot.source.recipe?.nodes.at(-1)?.scene;
		assert(scene?.kind === "shatter");
		assert.deepEqual(scene.span, span);
	}
	const unrelatedSource: ProgrammaticSource = {
		...shots[0].source,
		durationFrames: 120,
		seed: 991,
		recipe: {
			version: 1,
			root: "marker",
			songStartSeconds: 0,
			outputRoles: ["foreground"],
			nodes: [
				{
					id: "marker",
					scene: {
						kind: "solid",
						role: "foreground",
						color: [0.9, 0.1, 0.8, 0.4],
					},
				},
			],
		},
	};
	const context = await get("context");
	await post("apply", {
		expectedRevision: context.revision,
		operations: [
			{
				kind: "update-project",
				projectId: context.project.id,
				patch: {
					name: "Creator Shatter E2E",
					canvasWidth: 640,
					canvasHeight: 360,
					frameRate: { numerator: 30, denominator: 1 },
					background: { type: "color", color: "#102030" },
				},
			},
			...authoredTrackIds.map((id, index) => ({
				kind: "create-track",
				track: {
					id,
					kind: "graphic",
					name: index ? "Unrelated preserved clip" : "Shatter scenes",
					hidden: index === 1,
				},
			})),
			...shots.map((shot, index) => ({
				kind: "create-clip",
				clip: {
					id: `shatter-${index}`,
					trackId: "shatter-shots",
					startTime: index * 240000,
					duration: 240000,
					trimStart: 0,
					trimEnd: 0,
					editing: {
						type: "graphic",
						name: variants[index].name,
						definitionId: "programmatic",
						params: {},
						programmatic: shot.source,
						effects: shot.effects,
					},
				},
			})),
			{
				kind: "create-clip",
				clip: {
					id: "shatter-unrelated",
					trackId: "shatter-unrelated-track",
					startTime: 0,
					duration: 480000,
					trimStart: 0,
					trimEnd: 0,
					editing: {
						type: "graphic",
						name: "Unrelated marker",
						definitionId: "programmatic",
						params: { opacity: 0.7 },
						programmatic: unrelatedSource,
					},
				},
			},
		],
	});
	const before = byId(await host.automation.clips());
	const tracksBefore = byId(await host.automation.tracks());
	for (const [index, shot] of shots.entries()) {
		const clip = before.find((clip) => clip.id === `shatter-${index}`);
		assert(clip?.editing?.type === "graphic");
		assert.deepEqual(clip.editing.programmatic, shot.source);
		assert.deepEqual(clip.editing.effects, shot.effects);
	}
	const initialRevision = (await get("context")).revision;
	await rename(input, join(root, "unavailable-input"));
	await host.close();
	host = await startHost(options);
	assert.deepEqual(byId(await host.automation.clips()), before);
	assert.deepEqual(byId(await host.automation.tracks()), tracksBefore);
	assert.equal((await get("context")).revision, initialRevision);
	for (const resource of resources) {
		const response = await fetch(
			new URL("api/programmatic/resources/load", host.editorUrl),
			{
				method: "POST",
				body: JSON.stringify(resource),
			},
		);
		assert.equal(response.status, 200);
		const bytes = Buffer.from(await response.arrayBuffer());
		assert.equal(
			createHash("sha256").update(bytes).digest("hex"),
			resource.sha256,
		);
		assert.deepEqual(
			bytes,
			await readFile(join(root, "unavailable-input", resource.id)),
		);
	}
	await writeFile(
		join(root, "prepared.json"),
		JSON.stringify(
			{
				ok: true,
				templates: ["shatterImage"],
				originalInputUnavailable: true,
				hostReopened: true,
				assetKinds: ["transparent-image", "striped-image"],
				resources,
				initialRevision,
				clipDurationTicks: 240000,
				sampleLocalTicks: [60000, 120000],
				durationFrames: 120,
				authoredTrackIds,
				unrelatedClip: before.find((clip) => clip.id === "shatter-unrelated"),
				unrelatedTrack: tracksBefore.find(
					(track) => track.id === "shatter-unrelated-track",
				),
				authoringMode:
					"Host recipe replacement; actual editor preview/history/reload; no recipe parameter UI",
				shots: shots.map((shot, index) => ({
					id: `shatter-${index}`,
					startTime: index * 240000,
					source: shot.source,
					effects: shot.effects,
				})),
			},
			null,
			2,
		),
		{ flag: "wx" },
	);
	console.log(JSON.stringify({ editorUrl: host.editorUrl, root }));
	await new Promise<void>((resolve) => {
		process.stdin.once("data", () => resolve());
		process.stdin.once("end", () => resolve());
		process.on("SIGTERM", () => resolve());
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
		assert.deepEqual(byId(await host.automation.clips()), expected.clips);
		const reopenedTracks = await host.automation.tracks();
		assert.deepEqual(byId(reopenedTracks), expected.tracks);
		assert.deepEqual(
			reopenedTracks
				.filter((track) => authoredTrackIds.includes(track.id))
				.map((track) => track.id),
			expected.authoredTrackIds,
		);
		assert.equal((await get("context")).revision, expected.revision);
		await writeFile(
			join(root, "reopened-after-edit.json"),
			JSON.stringify(
				{
					ok: true,
					hostReopenedAfterEdits: true,
					revision: expected.revision,
					clipIds: expected.clips.map((clip: { id: string }) => clip.id),
					authoredTrackIds: expected.authoredTrackIds,
					comparison:
						"complete clip and track projections by ID; authored track order; revision",
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
