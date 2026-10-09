import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { asciiCubeModel } from "./prepare-ascii-three-probe";
import { threeEnvironment } from "./three-assets";

const [root, templatesDirectory] = process.argv.slice(2);
if (![root, templatesDirectory].every((p) => p && isAbsolute(p)))
	throw Error(
		"Expected absolute private artifact and Creator template directories",
	);
const author = join(root, "author");
await mkdir(author);
await writeFile(
	join(author, "scene.ts"),
	await readFile(join(templatesDirectory, "scene.ts")),
	{ flag: "wx" },
);
await writeFile(join(author, "cube.glb"), asciiCubeModel(), { flag: "wx" });
await writeFile(join(author, "neutral.hdr"), threeEnvironment(false), {
	flag: "wx",
});
const templates = await import(
	pathToFileURL(join(templatesDirectory, "templates.mjs")).href
);
// Import returns the full descriptors at runtime; only IDs are needed to form
// the actual template's inputProps before that IO has happened.
const template = templates.ditheredThree({
	sourceDirectory: author,
	model: { id: "cube.glb" },
	environment: { id: "neutral.hdr" },
	settings: { durationFrames: 60 },
});
const imports = [
	{
		id: "cube.glb",
		kind: "model",
		mimeType: "model/gltf-binary",
		filePath: join(author, "cube.glb"),
	},
	{
		id: "neutral.hdr",
		kind: "environment",
		mimeType: "image/vnd.radiance",
		filePath: join(author, "neutral.hdr"),
	},
];
const templateSources = await Promise.all(
	["templates.mjs", "scene.ts"].map(async (file) => ({
		file,
		sha256: createHash("sha256")
			.update(await readFile(join(templatesDirectory, file)))
			.digest("hex"),
	})),
);
await writeFile(
	join(root, "compile.json"),
	JSON.stringify({ ...template, imports, templateSources }, null, 2),
	{ flag: "wx", encoding: "utf8" },
);
