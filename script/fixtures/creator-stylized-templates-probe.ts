import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveProgrammaticFrameJson } from "opencut-wasm";
import { startHost } from "../../apps/cli/src/host";
import { TargetRegistry } from "../../apps/cli/src/target-registry";
import { prepareAsciiThreeProbe } from "./prepare-ascii-three-probe";
import { threePalette } from "./three-assets";

// Explicit private integration probe; neither installs dependencies nor contacts
// a running editor. Keep its dedicated project for the subsequent visual E2E.
const [assetDirectory, toolchain] = process.argv.slice(2);
if (
	!assetDirectory ||
	!toolchain ||
	!isAbsolute(assetDirectory) ||
	!isAbsolute(toolchain)
)
	throw Error(
		"Expected absolute Creator stylized assets and private Three toolchain directories",
	);
const parent = resolve(import.meta.dir, "../../.artifacts/creator-stylized");
await mkdir(parent, { recursive: true });
const root = await mkdtemp(join(parent, "run-"));
const templates = await import(
	pathToFileURL(join(assetDirectory, "templates.mjs")).href
);
const fixture = await prepareAsciiThreeProbe(join(root, "input"));
await writeFile(join(root, "input/palette.png"), threePalette(), {
	flag: "wx",
});
const author = join(root, "author");
await mkdir(author);
await writeFile(
	join(author, "scene.ts"),
	await readFile(join(assetDirectory, "scene.ts")),
	{ flag: "wx" },
);
const options = {
	projectRoot: join(root, "project"),
	registry: new TargetRegistry(join(root, "registry")),
	engineToolchainDirectory: toolchain,
	htmlBrowserExecutable: "",
	htmlFrameConnectionFile: "",
};
let host = await startHost(options);
const post = async (route: string, body: unknown) => {
	const response = await fetch(new URL(`api/${route}`, host.editorUrl), {
		method: "POST",
		body: JSON.stringify(body),
	});
	const result = await response.json();
	assert.equal(response.status, 200, JSON.stringify(result));
	return result;
};
try {
	const image = (
		await post("programmatic/resources/import", {
			id: "palette.png",
			kind: "image",
			mimeType: "image/png",
			filePath: join(root, "input/palette.png"),
		})
	).resource;
	const model = (
		await post("programmatic/resources/import", fixture.imports[0])
	).resource;
	const environment = (
		await post("programmatic/resources/import", fixture.imports[1])
	).resource;
	const retro = templates.retroMv({ image }),
		logo = templates.particleLogo({ image });
	const three = templates.asciiThree({
		sourceDirectory: author,
		model,
		environment,
		inputProps: { tint: "#28aaff" },
	});
	const compiled = await post("programmatic/build/compile", three.spec);
	const dither = templates.ditheredThree({
		sourceDirectory: author,
		model,
		environment,
		inputProps: { tint: "#28aaff" },
		dither: { threshold: 0.4, cellSize: 3 },
	});
	assert.deepEqual(
		dither.spec,
		three.spec,
		"Styling must not fork the Three scene compiler",
	);
	const shots = [
		retro,
		logo,
		{ source: compiled.source, effects: three.effects },
		{ source: compiled.source, effects: dither.effects },
	];
	for (const shot of shots) {
		for (const frameIndex of [0, 45, 89, 20, 0]) {
			const resolved = JSON.parse(
				resolveProgrammaticFrameJson(
					JSON.stringify({
						source: shot.source,
						clipStart: 0,
						clipDuration: 360000,
						trimStart: 0,
						timelineTime: frameIndex * 4000,
					}),
				),
			);
			assert.equal(resolved.error, undefined);
			assert.equal(resolved.frame.index, frameIndex);
		}
	}
	const operations = [
		{
			kind: "create-track",
			track: {
				id: "templates",
				name: "Creator templates",
				kind: "graphic",
				hidden: false,
			},
		},
		...shots.map((shot, index) => ({
			kind: "create-clip",
			clip: {
				id: `template-${index}`,
				trackId: "templates",
				startTime: index * 360000,
				duration: 360000,
				trimStart: 0,
				trimEnd: 0,
				editing: {
					type: "graphic",
					name: `Creator shot ${index + 1}`,
					definitionId: "programmatic",
					params: {},
					programmatic: shot.source,
					effects: shot.effects,
				},
			},
		})),
	];
	await post("apply", { expectedRevision: 0, operations });
	const before = await host.automation.clips();
	assert.equal(before.length, 4);
	assert.deepEqual(
		before.find((clip) => clip.id === "template-3")?.editing?.effects,
		dither.effects,
	);
	// Both names are fixed children of this invocation's freshly allocated root.
	await rename(author, join(root, "unavailable-author"));
	await rename(join(root, "input"), join(root, "unavailable-input"));
	await host.close();
	host = await startHost(options);
	assert.deepEqual(await host.automation.clips(), before);
	assert.deepEqual(
		(await post("programmatic/build/rebuild", compiled.source)).source,
		compiled.source,
	);
	const sources = [];
	for (const file of ["templates.mjs", "scene.ts"])
		sources.push({
			file,
			sha256: createHash("sha256")
				.update(await readFile(join(assetDirectory, file)))
				.digest("hex"),
		});
	const evidence = {
		ok: true,
		templates: ["retroMv", "particleLogo", "asciiThree", "ditheredThree"],
		originalInputsUnavailable: true,
		restarted: true,
		archiveRebuilt: true,
		sources,
		compiledDocumentSha256: compiled.source.resources[0].sha256,
		scope:
			"Rust frame validation, real Three compile, transaction, reopen and archived rebuild; template-specific visual/audio/UI E2E pending",
	};
	await writeFile(
		join(root, "evidence.json"),
		JSON.stringify(evidence, null, 2) + "\n",
		{ encoding: "utf8", flag: "wx" },
	);
	console.log(JSON.stringify({ ...evidence, artifacts: root }));
} finally {
	await host.close();
}
