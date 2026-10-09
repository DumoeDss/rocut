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
	const names = [
		"glassImage",
		"magnifyImage",
		"asciiSpotlight",
		"ditherSpotlight",
	];
	const shots = names.map((name) =>
		templates[name]({
			image,
			settings: { durationFrames: 60 },
			keyframes: {
				centerX: [
					{ time: 0, value: 0.2 },
					{ time: 240000, value: 0.8 },
				],
				centerY: [
					{ time: 0, value: 0.35 },
					{ time: 240000, value: 0.65 },
				],
				...(name === "magnifyImage"
					? {
							pulse: [
								{ time: 0, value: 0 },
								{ time: 120000, value: 1 },
								{ time: 236000, value: 0 },
							],
						}
					: {}),
			},
		}),
	);
	await post("apply", {
		expectedRevision: context.revision,
		operations: [
			{
				kind: "update-project",
				projectId: context.project.id,
				patch: {
					name: "Creator spatial E2E",
					canvasWidth: 640,
					canvasHeight: 360,
					frameRate: { numerator: 30, denominator: 1 },
					background: { type: "color", color: "#102030" },
				},
			},
			{
				kind: "create-track",
				track: {
					id: "spatial-shots",
					kind: "graphic",
					name: "Spatial shots",
					hidden: false,
				},
			},
			...shots.map((shot, index) => ({
				kind: "create-clip",
				clip: {
					id: `spatial-${index}`,
					trackId: "spatial-shots",
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
			},
			null,
			2,
		),
		{ flag: "wx" },
	);
	// Only the owning probe consumes this authenticated URL over its private pipe.
	console.log(JSON.stringify({ editorUrl: host.editorUrl, root }));
	await new Promise<void>((resolve) => {
		process.stdin.once("data", () => resolve());
		process.stdin.once("end", () => resolve());
		process.on("SIGTERM", () => resolve());
	});
} finally {
	await host.close();
}
