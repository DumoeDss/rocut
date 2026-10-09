import assert from "node:assert/strict";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { startHost } from "../../apps/cli/src/host";
import { TargetRegistry } from "../../apps/cli/src/target-registry";
import { fusionImage } from "./stylized-fusion-assets";

const [root, templateDirectory] = process.argv.slice(2);
assert([root, templateDirectory].every((p) => p && isAbsolute(p)));
const input = join(root, "input");
await mkdir(input);
await writeFile(join(input, "pattern.png"), fusionImage("red"), { flag: "wx" });
const templates = await import(
	pathToFileURL(join(templateDirectory, "templates.mjs")).href
);
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
try {
	const image = (
		await post("programmatic/resources/import", {
			id: "pattern.png",
			kind: "image",
			mimeType: "image/png",
			filePath: join(input, "pattern.png"),
		})
	).resource;
	const context = await get("context");
	const names = ["displacementImage", "rippleImage", "forceFieldImage"];
	const impacts = [
		{ time: 0, x: 0.37, y: 0.42, amplitude: 1 },
		{ time: 120000, x: 0.66, y: 0.59, amplitude: -0.75 },
	];
	const waveParams = {
		amount: 1,
		speed: 0.35,
		wavelength: 0.15,
		width: 0.32,
		refraction: 0.08,
		decay: 0.25,
		lifetime: 1.6,
	};
	const shots = [
		templates.displacementImage({
			image,
			settings: { durationFrames: 60 },
			params: {
				amount: 1,
				displacement: 0.075,
				cellSize: 48,
				dispersion: 0.05,
				seed: 37,
				radius: 0.4,
				feather: 0.15,
			},
			keyframes: {
				centerX: [
					{ time: 0, value: 0.2 },
					{ time: 240000, value: 0.8 },
				],
				centerY: [
					{ time: 0, value: 0.35 },
					{ time: 240000, value: 0.65 },
				],
			},
		}),
		templates.rippleImage({
			image,
			settings: { durationFrames: 60 },
			impacts,
			params: waveParams,
		}),
		templates.forceFieldImage({
			image,
			settings: { durationFrames: 60 },
			impacts,
			params: {
				...waveParams,
				ringOpacity: 0.75,
				glow: 0,
				colorR: 0.1,
				colorG: 0.8,
				colorB: 1,
			},
		}),
	];
	for (const shot of shots.slice(1)) {
		const params = shot.effects[0].params;
		assert.equal(params.eventCount, impacts.length);
		for (const [index, impact] of impacts.entries()) {
			assert.equal(params[`event${index}Time`], impact.time);
			assert.equal(params[`event${index}X`], impact.x);
			assert.equal(params[`event${index}Y`], impact.y);
			assert.equal(params[`event${index}Amplitude`], impact.amplitude);
		}
	}
	await post("apply", {
		expectedRevision: context.revision,
		operations: [
			{
				kind: "update-project",
				projectId: context.project.id,
				patch: {
					name: "Creator distortion E2E",
					canvasWidth: 640,
					canvasHeight: 360,
					frameRate: { numerator: 30, denominator: 1 },
					background: { type: "color", color: "#102030" },
				},
			},
			{
				kind: "create-track",
				track: {
					id: "distortion-shots",
					kind: "graphic",
					name: "Distortion shots",
					hidden: false,
				},
			},
			...shots.map((shot, index) => ({
				kind: "create-clip",
				clip: {
					id: `distortion-${index}`,
					trackId: "distortion-shots",
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
						animations: shot.animations,
					},
				},
			})),
		],
	});
	const before = await host.automation.clips();
	for (let i = 0; i < shots.length; i++) {
		const clip = before.find((clip) => clip.id === `distortion-${i}`);
		assert(clip && "editing" in clip && clip.editing?.type === "graphic");
		assert.deepEqual(clip.editing.programmatic, shots[i].source);
		assert.deepEqual(clip.editing.effects, shots[i].effects);
		assert.deepEqual(clip.editing.animations, shots[i].animations);
	}
	await rename(input, join(root, "unavailable-input"));
	await host.close();
	host = await startHost(options);
	assert.deepEqual(await host.automation.clips(), before);
	await writeFile(
		join(root, "prepared.json"),
		JSON.stringify(
			{
				ok: true,
				templates: names,
				originalInputUnavailable: true,
				hostReopened: true,
				clipDurationTicks: 240000,
				sampleLocalTicks: [60000, 180000],
				impacts,
				shots: shots.map((shot, index) => ({
					id: `distortion-${index}`,
					startTime: index * 240000,
					source: shot.source,
					effects: shot.effects,
					animations: shot.animations,
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
} finally {
	await host.close();
}
