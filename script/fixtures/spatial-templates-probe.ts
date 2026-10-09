import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { startHost } from "../../apps/cli/src/host";
import { TargetRegistry } from "../../apps/cli/src/target-registry";
import { threePalette } from "./three-assets";

const [assetDirectory] = process.argv.slice(2);
assert(
	assetDirectory && isAbsolute(assetDirectory),
	"Expected an absolute Creator stylized asset directory",
);
const templates = await import(
	pathToFileURL(join(assetDirectory, "templates.mjs")).href
);
const parent = resolve(import.meta.dir, "../../.artifacts/spatial-templates");
await mkdir(parent, { recursive: true });
const root = await mkdtemp(join(parent, "run-"));
const input = join(root, "input");
await mkdir(input);
await writeFile(join(input, "palette.png"), threePalette(), { flag: "wx" });
const options = {
	projectRoot: join(root, "project"),
	registry: new TargetRegistry(join(root, "registry")),
	htmlBrowserExecutable: "",
	htmlFrameConnectionFile: "",
};
let host = await startHost(options);
const post = async (route: string, body: unknown, status = 200) => {
	const response = await fetch(new URL(`api/${route}`, host.editorUrl), {
		method: "POST",
		body: JSON.stringify(body),
	});
	const result = await response.json();
	assert.equal(response.status, status, JSON.stringify(result));
	return result;
};
try {
	const image = (
		await post("programmatic/resources/import", {
			id: "palette.png",
			kind: "image",
			mimeType: "image/png",
			filePath: join(input, "palette.png"),
		})
	).resource;
	const catalog = await (
		await fetch(new URL("api/editing/catalog", host.editorUrl))
	).json();
	const names = [
		"glassImage",
		"magnifyImage",
		"asciiSpotlight",
		"ditherSpotlight",
	];
	const shots = names.map((name) =>
		templates[name]({
			image,
			settings: { durationFrames: 30 },
			keyframes: {
				centerX: [
					{ time: 0, value: 0.2 },
					{ time: 120000, value: 0.8 },
				],
				centerY: [
					{ time: 0, value: 0.35 },
					{ time: 120000, value: 0.65 },
				],
				...(name === "magnifyImage"
					? {
							pulse: [
								{ time: 0, value: 0 },
								{ time: 8000, value: 1 },
								{ time: 20000, value: 0 },
							],
						}
					: {}),
			},
		}),
	);
	for (const shot of shots) {
		const fx = shot.effects[0];
		assert(catalog.effects[fx.type]);
		for (const field of catalog.effects[fx.type]) {
			if (field.required !== false)
				assert(
					Object.hasOwn(fx.params, field.key),
					`Missing ${fx.type}.${field.key}`,
				);
		}
	}
	const editing = shots.map((shot, index) => ({
		type: "graphic",
		name: names[index],
		definitionId: "programmatic",
		params: {},
		programmatic: shot.source,
		effects: shot.effects,
		animations: shot.animations,
	}));
	const operations = [
		{
			kind: "create-track",
			track: {
				id: "spatial-templates",
				name: "Spatial templates",
				kind: "graphic",
				hidden: false,
			},
		},
		...editing.map((value, index) => ({
			kind: "create-clip",
			clip: {
				id: `spatial-${index}`,
				trackId: "spatial-templates",
				startTime: index * 120000,
				duration: 120000,
				trimStart: 0,
				trimEnd: 0,
				editing: value,
			},
		})),
	];
	await post("apply", { expectedRevision: 0, operations });
	const before = await host.automation.clips();
	assert.equal(before.length, 4);
	for (let index = 0; index < 4; index++) {
		const saved = before.find(
			(clip) => clip.id === `spatial-${index}`,
		)?.editing;
		assert.deepEqual(saved?.effects, editing[index].effects);
		assert.deepEqual(saved?.animations, editing[index].animations);
		const bad = structuredClone(editing[index]);
		bad.effects[0].params.radius = -1;
		await post(
			"apply",
			{
				expectedRevision: 1,
				operations: [
					{
						kind: "update-clip",
						clipId: `spatial-${index}`,
						patch: { editing: bad },
					},
				],
			},
			409,
		);
		assert.deepEqual(await host.automation.clips(), before);
	}
	const badPulse = structuredClone(editing[1]);
	badPulse.animations["effects.template-magnify.params.pulse"].keys[1].value =
		2;
	await post(
		"apply",
		{
			expectedRevision: 1,
			operations: [
				{
					kind: "update-clip",
					clipId: "spatial-1",
					patch: { editing: badPulse },
				},
			],
		},
		409,
	);
	assert.deepEqual(await host.automation.clips(), before);
	await rename(input, join(root, "unavailable-input"));
	await host.close();
	host = await startHost(options);
	assert.deepEqual(await host.automation.clips(), before);
	const modified = structuredClone(editing[1]);
	modified.effects[0].params.hud = 0.4;
	modified.effects[0].params.lineWidth = 3;
	await post("apply", {
		expectedRevision: 1,
		operations: [
			{
				kind: "update-clip",
				clipId: "spatial-1",
				patch: { editing: modified },
			},
		],
	});
	await host.close();
	host = await startHost(options);
	assert.deepEqual(
		(await host.automation.clips()).find((clip) => clip.id === "spatial-1")
			?.editing?.effects,
		modified.effects,
	);
	const sources = [];
	for (const file of ["templates.mjs", "spatial.mjs"])
		sources.push({
			file,
			sha256: createHash("sha256")
				.update(await readFile(join(assetDirectory, file)))
				.digest("hex"),
		});
	const evidence = {
		ok: true,
		templates: names,
		sources,
		originalInputUnavailable: true,
		restarts: 2,
		invalidUpdatesRejected: 5,
		checks: [
			"live catalog matches required fields",
			"four real transactions",
			"trajectory and pulse keyframes",
			"reopen",
			"HUD edit persistence",
			"invalid update atomicity",
		],
		scope:
			"Agent/source persistence only; no attached-editor rendering or export in this probe",
	};
	await writeFile(
		join(root, "evidence.json"),
		JSON.stringify(evidence, null, 2) + "\n",
		{ flag: "wx" },
	);
	console.log(JSON.stringify({ ...evidence, artifacts: root }));
} finally {
	await host.close();
}
