import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { nativeVideoFixture } from "./native-video-fixture.mjs";

export async function prepareRemotionProbe(staging: string) {
	const fixture = dirname(fileURLToPath(import.meta.url));
	const project = join(staging, "project");
	for (const dir of ["src", "assets", "public"]) await mkdir(join(project, dir), { recursive: true });
	for (const file of ["index.tsx", "delayed.tsx", "media.tsx", "style.css"]) await copyFile(join(fixture, "remotion", file), join(project, "src", file));
	const video = await nativeVideoFixture();
	for (const name of ["assets/frames.webm", "public/frames.webm"]) await writeFile(join(project, name), video);
	await copyFile(join(fixture, "../../apps/web/public/motion-text/fonts/ibm-plex-mono-medium.ttf"), join(project, "assets/font.ttf"));
	const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM6kAAAAASUVORK5CYII=", "base64");
	for (const name of ["assets/pixel.png", "public/pixel.png"]) await writeFile(join(project, name), png);
	return {
		version: 1, engine: "remotion", sourceDirectory: project, entryFile: "src/index.tsx",
		files: ["src/index.tsx", "src/delayed.tsx", "src/media.tsx", "src/style.css", "assets/font.ttf", "assets/pixel.png", "public/pixel.png", "assets/frames.webm", "public/frames.webm"],
		compositionId: "Rocut", inputProps: { color: "#00ff00", unsafeText: "</script>" },
		width: 64, height: 64, frameRate: { numerator: 30, denominator: 1 }, durationFrames: 60, seed: 7,
	};
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	if (!process.argv[2]) throw Error("Expected owned staging directory");
	const staging = resolve(process.argv[2]);
	await writeFile(join(staging, "compile.json"), JSON.stringify(await prepareRemotionProbe(staging)), "utf8");
}
