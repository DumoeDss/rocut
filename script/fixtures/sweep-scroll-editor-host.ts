import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
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
await copyFile(
	join(
		import.meta.dir,
		"../../apps/web/public/motion-text/fonts/ibm-plex-mono-medium.ttf",
	),
	join(input, "sweep.ttf"),
);
const templates = await import(
	pathToFileURL(join(templateDirectory, "templates.mjs")).href
);
assert.equal(typeof templates.asciiSweepText, "function");
assert.equal(typeof templates.particleScrollImage, "function");
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
	const resources = [];
	for (const descriptor of [
		{
			id: "sweep.ttf",
			kind: "font",
			mimeType: "font/ttf",
			font: { family: "RocutSweepEditorFixture", weight: 500, style: "normal" },
		},
		{ id: "logo.png", kind: "image", mimeType: "image/png" },
	]) {
		resources.push(
			(
				await post("programmatic/resources/import", {
					...descriptor,
					filePath: join(input, descriptor.id),
				})
			).resource,
		);
	}
	const [font, image] = resources;
	const span = { startFrame: 3, durationFrames: 54 };
	const names = ["asciiSweepText", "particleScrollImage"];
	const shots = [
		templates.asciiSweepText({
			font,
			textA:
				"WORDS BECOME LIGHT\nLINES CROSS TIME\nFRAMES KEEP MEMORY\nSHAPES FIND RHYTHM",
			textB:
				"LIGHT BECOMES WORDS\nTIME CROSSES LINES\nMEMORY KEEPS FRAMES\nRHYTHM FINDS SHAPES",
			settings: { width: 640, height: 360, durationFrames: 60, seed: 37 },
			role: "graphics",
			span,
			easing: "linear",
			sweep: {
				fontSize: 36,
				rect: [0.05, 0.2, 0.9, 0.7],
				bandWidth: 0.2,
				color: [0.95, 0.97, 1, 1],
				activeColor: [0.2, 1, 0.6, 1],
				glyphs: "01#+",
				opacity: 0.9,
				direction: "leftToRight",
			},
		}),
		templates.particleScrollImage({
			image,
			settings: { width: 640, height: 360, durationFrames: 60, seed: 53 },
			role: "subject",
			span,
			easing: "linear",
			particles: {
				columns: 16,
				rows: 12,
				rect: [0.1, 0.1, 0.8, 0.8],
				fit: "contain",
				band: 0.5,
				scatter: 0.12,
				spin: 0.5,
				opacity: 0.85,
				direction: "left-to-right",
			},
		}),
	];
	for (const [index, shot] of shots.entries()) {
		assert.equal(shot.source.durationFrames, 60);
		assert.equal(shot.source.seed, [37, 53][index]);
		assert.equal(
			shot.source.recipe.nodes[0].scene.role,
			["graphics", "subject"][index],
		);
		assert.deepEqual(shot.source.recipe.nodes[0].scene.span, span);
		assert.equal(shot.source.recipe.nodes[0].scene.easing, "linear");
		assert.deepEqual(shot.source.resources, [resources[index]]);
	}
	const context = await get("context");
	await post("apply", {
		expectedRevision: context.revision,
		operations: [
			{
				kind: "update-project",
				projectId: context.project.id,
				patch: {
					name: "Creator sweep and scroll E2E",
					canvasWidth: 640,
					canvasHeight: 360,
					frameRate: { numerator: 30, denominator: 1 },
					background: { type: "color", color: "#102030" },
				},
			},
			{
				kind: "create-track",
				track: {
					id: "sweep-scroll-shots",
					kind: "graphic",
					name: "Sweep and scroll shots",
					hidden: false,
				},
			},
			...shots.map((shot, index) => ({
				kind: "create-clip",
				clip: {
					id: `sweep-scroll-${index}`,
					trackId: "sweep-scroll-shots",
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
		const clip = before.find((clip) => clip.id === `sweep-scroll-${index}`);
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
				assetKinds: ["declared-font", "transparent-image"],
				resources,
				clipDurationTicks: 240000,
				sampleLocalTicks: [60000, 120000],
				authoringMode:
					"Host recipe replacement; actual editor preview/history/reload; no recipe parameter UI",
				shots: shots.map((shot, index) => ({
					id: `sweep-scroll-${index}`,
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
