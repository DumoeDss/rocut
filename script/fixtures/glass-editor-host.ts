import assert from "node:assert/strict";
import { readFile, rename, writeFile, mkdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { startHost } from "../../apps/cli/src/host";
import { TargetRegistry } from "../../apps/cli/src/target-registry";
import { glassObjectGpuAssets } from "./glass-object-gpu-assets.ts";

const [root, staticDir, creator, pkg, threeToolchain, browserExecutable] =
	process.argv.slice(2);
assert(
	[root, staticDir, creator, pkg, threeToolchain, browserExecutable].every(
		(value) => value && isAbsolute(value),
	),
);
const THREE = await import(
	pathToFileURL(
		join(threeToolchain, "node_modules/three/build/three.module.js"),
	).href
);
const { glassObjectThree } = await import(pathToFileURL(creator).href);
const wasm = await import(pathToFileURL(join(pkg, "opencut_wasm_sync.js")).href);
const input = join(root, "input");
const options = {
	projectRoot: join(root, "project"),
	registry: new TargetRegistry(join(root, "registry")),
	engineToolchainDirectory: threeToolchain,
	htmlBrowserExecutable: browserExecutable,
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
const snapshot = async () => ({
	clips: byId(await host.automation.clips()),
	tracks: byId(await host.automation.tracks()),
	revision: await host.automation.revision(),
	authoredTrackIds: (await host.automation.tracks())
		.filter((track) => track.id === "glass-shots")
		.map((track) => track.id),
});
try {
	await mkdir(input);
	const resources: Array<{ id: string; kind: string; mimeType: string }> = [];
	for (const asset of glassObjectGpuAssets(THREE).slice(0, 2)) {
		const filePath = join(input, asset.id);
		await writeFile(filePath, asset.body, { flag: "wx" });
		const { resource } = await request("programmatic/resources/import", {
			id: asset.id,
			kind: asset.kind,
			mimeType: asset.mimeType,
			filePath,
		});
		resources.push(resource);
	}
	const shot = await glassObjectThree({
		sourceDirectory: join(creator, ".."),
		model: resources[0],
		environment: resources[1],
		settings: {
			width: 192,
			height: 128,
			durationFrames: 49,
			frameRate: { numerator: 24, denominator: 1 },
		},
		glass: {
			transmission: 0.9,
			ior: 1.5,
			thickness: 0.5,
			roughness: 0.05,
			dispersion: 0.05,
			environmentIntensity: 1,
		},
		resolveParams: wasm.resolveGlassObjectParamsJson,
	});
	const compiled = await request("programmatic/build/compile", shot.spec);
	const context = await request("context");
	await request("apply", {
		expectedRevision: context.revision,
		operations: [
			{
				kind: "update-project",
				projectId: context.project.id,
				patch: {
					name: "Glass real editor acceptance",
					canvasWidth: 192,
					canvasHeight: 128,
					frameRate: { numerator: 24, denominator: 1 },
				},
			},
			{
				kind: "create-track",
				track: {
					id: "glass-shots",
					kind: "graphic",
					name: "Glass shot",
					hidden: false,
				},
			},
			{
				kind: "create-clip",
				clip: {
					id: "glass-object",
					trackId: "glass-shots",
					startTime: 0,
					duration: 245000,
					trimStart: 0,
					trimEnd: 0,
					editing: {
						type: "graphic",
						name: "Glass Object authoring",
						definitionId: "programmatic",
						params: {},
						effects: shot.effects,
						programmatic: compiled.source,
					},
				},
			},
		],
	});
	const before = await snapshot();
	await host.close();
	const backup = join(root, "unavailable-input");
	await rename(input, backup);
	host = await startHost(options);
	assert.deepEqual(await snapshot(), before);
	await writeFile(
		join(root, "prepared.json"),
		JSON.stringify(
			{
				ok: true,
				hostReopened: true,
				...before,
				authoring:
					"Host-authored archived Three glass source; actual editor Input props edit and local history",
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
