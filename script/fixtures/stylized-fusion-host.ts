import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { startHost } from "../../apps/cli/src/host";
import { TargetRegistry } from "../../apps/cli/src/target-registry";
import { asciiCubeModel } from "./prepare-ascii-three-probe";
import { threeEnvironment } from "./three-assets";
import { fusionAudio, fusionImage } from "./stylized-fusion-assets";

const [root, templateDirectory, toolchain, browser] = process.argv.slice(2);
if (
	[root, templateDirectory, toolchain, browser].some(
		(p) => !p || !isAbsolute(p),
	)
)
	throw Error(
		"Expected private artifact root, Creator templates, toolchain and Chromium paths",
	);
const input = join(root, "input"),
	author = join(root, "author");
await mkdir(input);
await mkdir(author);
for (const kind of ["red", "blue", "logo"] as const)
	await writeFile(join(input, kind + ".png"), fusionImage(kind), {
		flag: "wx",
	});
await writeFile(join(input, "music.wav"), fusionAudio(), { flag: "wx" });
await writeFile(join(input, "cube.glb"), asciiCubeModel(), { flag: "wx" });
await writeFile(join(input, "environment.hdr"), threeEnvironment(false), {
	flag: "wx",
});
await writeFile(
	join(author, "scene.ts"),
	await readFile(join(templateDirectory, "scene.ts")),
	{ flag: "wx" },
);
const templates = await import(
	pathToFileURL(join(templateDirectory, "templates.mjs")).href
);
const options = {
	projectRoot: join(root, "project"),
	registry: new TargetRegistry(join(root, "registry")),
	engineToolchainDirectory: toolchain,
	htmlBrowserExecutable: browser,
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
	assert.equal(response.status, 200, route + ": " + JSON.stringify(value));
	return value;
};
const get = async (route: string) =>
	(await fetch(new URL(`api/${route}`, host.editorUrl))).json();
const revision = async () => (await get("context")).revision;
try {
	const resources = {} as Record<string, any>;
	for (const [id, kind, mimeType] of [
		["red.png", "image", "image/png"],
		["blue.png", "image", "image/png"],
		["logo.png", "image", "image/png"],
		["cube.glb", "model", "model/gltf-binary"],
		["environment.hdr", "environment", "image/vnd.radiance"],
	])
		resources[id] = (
			await post("programmatic/resources/import", {
				id,
				kind,
				mimeType,
				filePath: join(input, id),
			})
		).resource;
	const song = await post("media/import", {
		filePath: join(input, "music.wav"),
		expectedRevision: await revision(),
		idempotencyKey: "fusion-song",
	});
	const context = await get("context");
	const retro = templates.retroMv({
		image: resources["red.png"],
		settings: { durationFrames: 120 },
	});
	const logo = templates.particleLogo({
		image: resources["logo.png"],
		settings: { durationFrames: 60 },
	});
	const scene = (id: string) =>
		templates.retroMv({
			image: resources[id],
			settings: { durationFrames: 30 },
		}).source.recipe.nodes[0].scene;
	const peel = {
		source: {
			version: 1,
			runtime: "canvas-worker",
			code: "",
			width: 640,
			height: 360,
			frameRate: { numerator: 30, denominator: 1 },
			durationFrames: 30,
			seed: 19,
			resources: [resources["red.png"], resources["blue.png"]],
			recipe: {
				version: 1,
				root: "fold",
				songStartSeconds: 0,
				outputRoles: ["background", "subject", "graphics", "foreground"],
				nodes: [
					{ id: "a", scene: scene("red.png") },
					{ id: "b", scene: scene("blue.png") },
					{
						id: "fold",
						scene: {
							kind: "transition",
							from: "a",
							to: "b",
							span: { startFrame: 0, durationFrames: 29 },
							easing: "linear",
							style: {
								kind: "peel",
								direction: "left",
								curl: 0.17,
								segments: 32,
								shading: 0.6,
								perspective: 0.5,
							},
						},
					},
				],
			},
		},
		effects: [],
	};
	const three = templates.asciiThree({
		sourceDirectory: author,
		model: resources["cube.glb"],
		environment: resources["environment.hdr"],
	});
	const compiled = await post("programmatic/build/compile", three.spec);
	const shots = [
		retro,
		logo,
		peel,
		{ source: compiled.source, effects: three.effects },
	];
	const starts = [0, 480000, 720000, 840000],
		durations = [480000, 240000, 120000, 360000];
	await post("apply", {
		expectedRevision: await revision(),
		operations: [
			{
				kind: "update-project",
				projectId: context.project.id,
				patch: {
					name: "Creator fusion E2E",
					canvasWidth: 640,
					canvasHeight: 360,
					frameRate: { numerator: 30, denominator: 1 },
					background: { type: "color", color: "#102030" },
				},
			},
			{
				kind: "create-track",
				track: {
					id: "fusion-shots",
					kind: "graphic",
					name: "Creator shots",
					hidden: false,
				},
			},
			{
				kind: "create-track",
				track: {
					id: "fusion-music",
					kind: "audio",
					name: "Test music",
					hidden: false,
				},
			},
			...shots.map((shot, index) => ({
				kind: "create-clip",
				clip: {
					id: `fusion-${index}`,
					trackId: "fusion-shots",
					startTime: starts[index],
					duration: durations[index],
					trimStart: 0,
					trimEnd: 0,
					editing: {
						type: "graphic",
						name: ["Retro MV", "Particle logo", "A-B Peel", "ASCII Three"][
							index
						],
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
					id: "fusion-song",
					trackId: "fusion-music",
					assetId: song.asset.id,
					startTime: 0,
					duration: 1200000,
					trimStart: 0,
					trimEnd: 0,
					editing: {
						type: "audio",
						name: "Test music",
						params: { volume: -6 },
					},
				},
			},
		],
	});
	const lyrics = await post("motion-text/sequences", {
		source:
			"[00:00.00]LIGHTS RISE\n[00:02.00]COLORS MOVE\n[00:04.00]PIECES GATHER\n[00:06.00]TURN THE PAGE\n[00:07.00]SHAPES BECOME TYPE",
		sourceFormat: "lrc",
		language: "en",
		duration: 1200000,
		startTime: 0,
		starterPreset: "clean-caption",
		seed: 19,
		expectedRevision: await revision(),
		idempotencyKey: "fusion-lyrics",
	});
	// The factory leaves optional presentation metadata unset. Declare it before
	// exact persistence comparison; track order is checked in the native record.
	await post("apply", {
		expectedRevision: await revision(),
		operations: [
			// Overlay order is top-to-bottom; the factory does not implicitly move
			// a new lyric track above an existing opaque graphic track.
			{
				kind: "reorder-tracks",
				trackIds: [
					lyrics.trackId,
					...(await host.automation.tracks())
						.filter((track) => track.id !== lyrics.trackId)
						.map((track) => track.id),
				],
			},
			{
				kind: "update-clip",
				clipId: lyrics.clipId,
				patch: {
					editing: {
						type: "motion-text",
						name: "Fixture lyrics",
						hidden: false,
						params: {},
					},
				},
			},
		],
	});
	const clipsById = async () =>
		(await host.automation.clips()).toSorted((a, b) =>
			a.id.localeCompare(b.id),
		);
	const before = await clipsById(),
		beforeRecord = (await get("record")).record;
	assert.equal(
		beforeRecord.data.scenes[0].tracks.overlay[0].id,
		lyrics.trackId,
		"Native lyrics must render above opaque programmatic scenes",
	);
	await rename(input, join(root, "unavailable-input"));
	await rename(author, join(root, "unavailable-author"));
	await host.close();
	host = await startHost(options);
	assert.deepEqual(await clipsById(), before);
	assert.deepEqual((await get("record")).record, beforeRecord);
	assert.deepEqual(
		(await post("programmatic/build/rebuild", compiled.source)).source,
		compiled.source,
	);
	await writeFile(
		join(root, "prepared.json"),
		JSON.stringify(
			{
				ok: true,
				revision: await revision(),
				lyrics,
				song: song.asset,
				inputAudioSha256: createHash("sha256")
					.update(fusionAudio())
					.digest("hex"),
				checks: [
					"all four shots created through Agent transactions",
					"native lyrics created through motion-text factory",
					"native lyrics explicitly ordered above opaque scenes",
					"independent real audio media import",
					"original inputs unavailable",
					"Host restarted and record exactly preserved",
					"Three rebuilt from archived inputs",
				],
			},
			null,
			2,
		),
		{ flag: "wx", encoding: "utf8" },
	);
	// Parent consumes this over a private pipe; never forwards the authenticated URL to logs.
	console.log(JSON.stringify({ editorUrl: host.editorUrl, root }));
	await new Promise<void>((resolve) => {
		process.stdin.once("data", () => resolve());
		process.stdin.once("end", () => resolve());
		process.on("SIGTERM", () => resolve());
	});
} finally {
	await host.close();
}
