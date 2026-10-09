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
try {
	const image = (
		await post("programmatic/resources/import", {
			id: "pattern.png",
			kind: "image",
			mimeType: "image/png",
			filePath: join(input, "pattern.png"),
		})
	).resource;
	const context = await (
		await fetch(new URL("api/context", host.editorUrl))
	).json();
	const names = ["laserImage", "decryptRevealImage"];
	const progress = [
		[0.2, 0.9],
		[0.15, 0.85],
	];
	const keyframes = (index: number) => ({
		progress: [
			{ time: 0, value: progress[index][0] },
			{ time: 240000, value: progress[index][1] },
		],
	});
	const shots = [
		templates.laserImage({
			image,
			settings: { durationFrames: 60 },
			params: {
				amount: 1,
				progress: 0.2,
				direction: 0,
				width: 0.08,
				feather: 0.2,
				glow: 0.75,
				colorR: 0.2,
				colorG: 0.85,
				colorB: 1,
			},
			keyframes: keyframes(0),
		}),
		templates.decryptRevealImage({
			image,
			settings: { durationFrames: 60 },
			params: {
				amount: 1,
				progress: 0.15,
				cellSize: 12,
				contrast: 1,
				seed: 1,
				centerX: 0.5,
				centerY: 0.5,
				radius: 2,
				feather: 0,
				colorR: 0.2,
				colorG: 1,
				colorB: 0.55,
			},
			keyframes: keyframes(1),
		}),
	];
	for (const [index, shot] of shots.entries()) {
		const id = shot.effects[0].id;
		const keys = shot.animations[`effects.${id}.params.progress`].keys;
		assert.deepEqual(
			keys.map((key: { time: number; value: number }) => ({
				time: key.time,
				value: key.value,
			})),
			keyframes(index).progress,
		);
		assert.equal(shot.effects[0].params.progress, progress[index][0]);
	}
	await post("apply", {
		expectedRevision: context.revision,
		operations: [
			{
				kind: "update-project",
				projectId: context.project.id,
				patch: {
					name: "Creator reveal E2E",
					canvasWidth: 640,
					canvasHeight: 360,
					frameRate: { numerator: 30, denominator: 1 },
					background: { type: "color", color: "#102030" },
				},
			},
			{
				kind: "create-track",
				track: {
					id: "reveal-shots",
					kind: "graphic",
					name: "Reveal shots",
					hidden: false,
				},
			},
			...shots.map((shot, index) => ({
				kind: "create-clip",
				clip: {
					id: `reveal-${index}`,
					trackId: "reveal-shots",
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
	for (const [index, shot] of shots.entries()) {
		const clip = before.find((clip) => clip.id === `reveal-${index}`);
		assert(clip?.editing?.type === "graphic");
		assert.deepEqual(clip.editing.programmatic, shot.source);
		assert.deepEqual(clip.editing.effects, shot.effects);
		assert.deepEqual(clip.editing.animations, shot.animations);
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
				shots: shots.map((shot, index) => ({
					id: `reveal-${index}`,
					startTime: index * 240000,
					source: shot.source,
					effects: shot.effects,
					animations: shot.animations,
					sampleProgress: [
						progress[index][0] * 0.75 + progress[index][1] * 0.25,
						progress[index][0] * 0.25 + progress[index][1] * 0.75,
					],
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
