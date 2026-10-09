import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import { startHost } from "../../apps/cli/src/host";
import { TargetRegistry } from "../../apps/cli/src/target-registry";
import { liquidParameters, liquidSource } from "./liquid-browser-cases";

const [root, staticDir] = process.argv.slice(2);
assert([root, staticDir].every((value) => value && isAbsolute(value)));
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
const authoredTrackIds = ["liquid-shots", "liquid-sentinel"];
const snapshot = async () => ({
	clips: byId(await host.automation.clips()),
	tracks: byId(await host.automation.tracks()),
	revision: await host.automation.revision(),
	authoredTrackIds: (await host.automation.tracks())
		.filter((track) => authoredTrackIds.includes(track.id))
		.map((track) => track.id),
});
try {
	const source: ProgrammaticSource = {
		version: 1,
		runtime: "canvas-worker",
		width: 640,
		height: 360,
		frameRate: { numerator: 30, denominator: 1 },
		durationFrames: 60,
		seed: 7,
		code: `const pixels=(${liquidSource.toString()})(640,360,true);canvas.getContext('2d').putImageData(new ImageData(pixels,640,360),0,0);`,
	};
	const optical = {
		amount: [0.25, 0.75],
		refraction: [0.125, 0.25],
		dyeOpacity: [0.25, 0.75],
		colorR: [0.125, 0.875],
		colorG: [0.75, 0.25],
		colorB: [1, 0.25],
	};
	const animations = Object.fromEntries(
		Object.entries(optical).map(([key, values]) => [
			`effects.fluid.params.${key}`,
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
		id: `liquid-${index}`,
		trackId: "liquid-shots",
		startTime: index * 120000,
		duration: 120000,
		trimStart: 0,
		trimEnd: 0,
		editing: {
			type: "graphic",
			name: index ? "Six optical channels" : "Static Liquid controls",
			definitionId: "programmatic",
			params: {},
			programmatic: source,
			effects: [
				{
					id: "fluid",
					type: "liquid",
					enabled: true,
					params: liquidParameters(),
				},
			],
			...(index ? { animations } : {}),
		},
	}));
	const staticReferences = [4000, 12000, 24000].map((local, index) => ({
		...shots[0],
		id: `liquid-reference-${local}`,
		startTime: (index + 2) * 120000,
		editing: {
			...shots[0].editing,
			name: `Static optical reference ${local}`,
			effects: [
				{
					id: "fluid",
					type: "liquid",
					enabled: true,
					params: liquidParameters(
						Object.fromEntries(
							Object.entries(optical).map(([key, values]) => [
								key,
								values[0] + ((values[1] - values[0]) * local) / 24000,
							]),
						),
					),
				},
			],
		},
	}));
	const context = await request("context");
	await request("apply", {
		expectedRevision: context.revision,
		operations: [
			{
				kind: "update-project",
				projectId: context.project.id,
				patch: {
					name: "Liquid real editor acceptance",
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
					name: index ? "Unrelated hidden sentinel" : "Liquid shots",
					hidden: index === 1,
				},
			})),
			...[...shots, ...staticReferences].map((clip) => ({
				kind: "create-clip",
				clip,
			})),
			{
				kind: "create-clip",
				clip: {
					id: "liquid-unrelated",
					trackId: "liquid-sentinel",
					startTime: 0,
					duration: 240000,
					trimStart: 0,
					trimEnd: 0,
					editing: {
						type: "graphic",
						name: "Untouched source",
						definitionId: "programmatic",
						params: { opacity: 0.7 },
						programmatic: source,
					},
				},
			},
		],
	});
	const before = await snapshot();
	await host.close();
	host = await startHost(options);
	assert.deepEqual(await snapshot(), before);
	await writeFile(
		join(root, "prepared.json"),
		JSON.stringify(
			{
				ok: true,
				hostReopened: true,
				...before,
				optical,
				sampleLocalTicks: [4000, 12000, 24000],
				authoring:
					"Host-authored keyframes; actual editor Effects parameter input and local history",
			},
			null,
			2,
		),
		{ flag: "wx" },
	);
	console.log(JSON.stringify({ editorUrl: host.editorUrl }));
	await new Promise<void>((resolve) => {
		process.stdin.once("data", () => resolve());
		process.stdin.once("end", () => resolve());
		process.once("SIGTERM", () => resolve());
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
		await writeFile(
			join(root, "reopened-after-edit.json"),
			JSON.stringify(
				{
					ok: true,
					hostReopenedAfterEdits: true,
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
