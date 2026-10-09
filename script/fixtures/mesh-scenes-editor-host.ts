import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { startHost } from "../../apps/cli/src/host";
import { TargetRegistry } from "../../apps/cli/src/target-registry";
import { fusionImage } from "./stylized-fusion-assets";

const [root, templateDirectory] = process.argv.slice(2);
assert([root, templateDirectory].every((p) => p && isAbsolute(p)));
const input = join(root, "input");
await mkdir(input);
await writeFile(join(input, "logo.png"), fusionImage("logo"), { flag: "wx" });
const templates = await import(
	pathToFileURL(join(templateDirectory, "templates.mjs")).href
);
for (const name of ["gridImage", "hexFloatImage", "bendTransition"])
	assert.equal(typeof templates[name], "function");
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
try {
	const image = (
		await post("programmatic/resources/import", {
			id: "logo.png",
			kind: "image",
			mimeType: "image/png",
			filePath: join(input, "logo.png"),
		})
	).resource;
	const resources = [image],
		span = { startFrame: 3, durationFrames: 54 };
	const settings = { width: 640, height: 360, durationFrames: 60, seed: 37 };
	const names = ["gridImage", "hexFloatImage", "bendTransition"];
	const illust = (x: number, rotation: number) => ({
		kind: "illust",
		motion: span,
		easing: "linear",
		sprites: [
			{
				image: image.id,
				role: "subject",
				anchor: [0.5, 0.5],
				from: { x, y: 0.5, height: 0.65, rotation, opacity: 0.85 },
				to: { x, y: 0.5, height: 0.65, rotation, opacity: 0.85 },
			},
		],
	});
	const shots = [
		templates.gridImage({
			image,
			settings,
			span,
			grid: {
				columns: 8,
				rows: 6,
				lift: 0.25,
				tilt: 24,
				gap: 0.12,
				opacity: 0.85,
				rect: [0.1, 0.1, 0.8, 0.8],
				fit: "contain",
			},
		}),
		templates.hexFloatImage({
			image,
			settings: { ...settings, seed: 53 },
			span,
			hex: {
				size: 0.15,
				lift: 0.22,
				tilt: 0.4,
				gap: 0.12,
				opacity: 0.85,
				rect: [0.1, 0.1, 0.8, 0.8],
				fit: "contain",
			},
		}),
		templates.bendTransition({
			from: "a",
			to: "b",
			nodes: [
				{ id: "a", scene: illust(0.35, 0) },
				{ id: "b", scene: illust(0.65, 0.3) },
			],
			resources,
			settings: { ...settings, seed: 71 },
			span,
			bend: {
				direction: "left",
				hinge: 0.5,
				angle: Math.PI,
				perspective: 0.5,
				shading: 0.4,
			},
		}),
	];
	for (const [index, shot] of shots.entries()) {
		assert.equal(shot.source.durationFrames, 60);
		assert.equal(shot.source.seed, [37, 53, 71][index]);
		assert.deepEqual(shot.source.recipe.nodes.at(-1).scene.span, span);
		assert.deepEqual(shot.source.resources, resources);
	}
	const context = await get("context");
	await post("apply", {
		expectedRevision: context.revision,
		operations: [
			{
				kind: "update-project",
				projectId: context.project.id,
				patch: {
					name: "Creator mesh scenes E2E",
					canvasWidth: 640,
					canvasHeight: 360,
					frameRate: { numerator: 30, denominator: 1 },
					background: { type: "color", color: "#102030" },
				},
			},
			{
				kind: "create-track",
				track: {
					id: "mesh-scenes-shots",
					kind: "graphic",
					name: "Mesh scenes",
					hidden: false,
				},
			},
			...shots.map((shot, index) => ({
				kind: "create-clip",
				clip: {
					id: `mesh-scenes-${index}`,
					trackId: "mesh-scenes-shots",
					startTime: index * 240000,
					duration: 240000,
					trimStart: 0,
					trimEnd: 0,
					editing: {
						type: "graphic",
						name: names[index],
						definitionId: "programmatic",
						params: {},
						programmatic: shot.source,
						effects: shot.effects,
					},
				},
			})),
		],
	});
	const before = byId(await host.automation.clips());
	for (const [index, shot] of shots.entries()) {
		const clip = before.find((clip) => clip.id === `mesh-scenes-${index}`);
		assert(clip?.editing?.type === "graphic");
		assert.deepEqual(clip.editing.programmatic, shot.source);
		assert.deepEqual(clip.editing.effects, shot.effects);
	}
	await rename(input, join(root, "unavailable-input"));
	await host.close();
	host = await startHost(options);
	assert.deepEqual(byId(await host.automation.clips()), before);
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
				templates: names,
				originalInputUnavailable: true,
				hostReopened: true,
				assetKinds: ["transparent-image"],
				resources,
				clipDurationTicks: 240000,
				sampleLocalTicks: [60000, 120000],
				authoringMode:
					"Host recipe replacement; actual editor preview/history/reload; no recipe parameter UI",
				shots: shots.map((shot, index) => ({
					id: `mesh-scenes-${index}`,
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
	// The runner closes the browser before signalling stop. Verify the edited
	// project with a new Host instance, not the previous Host's in-memory state.
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
				.filter((track) => expected.authoredTrackIds.includes(track.id))
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
