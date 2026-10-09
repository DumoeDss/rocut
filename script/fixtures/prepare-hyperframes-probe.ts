import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { nativeVideoFixture } from "./native-video-fixture.mjs";
import { hyperframesMediaVariants } from "./hyperframes-media-cases";

// Stage only the diagnostic fixture. All compilation goes through the real API.
const [toolchain, staging] = process.argv.slice(2);
if (!toolchain || !staging) throw Error("Expected isolated toolchain and staging roots");
const gsap = join(resolve(toolchain), "node_modules/gsap");
const gsapManifest = JSON.parse(await readFile(join(gsap, "package.json"), "utf8"));
if (gsapManifest.version !== "3.15.0") throw Error("Fixture requires gsap 3.15.0");
const project = join(resolve(staging), "project");
await mkdir(join(project, "compositions"), { recursive: true });
const files = ["index.html", "compositions/scene.html", "compositions/leaf.html", "gsap.js", "assets/font.ttf", "assets/pixel.png"];
for (const name of files.slice(0, 3))
	await copyFile(join(dirname(fileURLToPath(import.meta.url)), "hyperframes", name), join(project, name));
await copyFile(join(gsap, "dist/gsap.min.js"), join(project, "gsap.js"));
await mkdir(join(project, "assets"));
await copyFile(join(dirname(fileURLToPath(import.meta.url)), "../../apps/web/public/motion-text/fonts/ibm-plex-mono-medium.ttf"), join(project, "assets/font.ttf"));
await writeFile(join(project, "assets/pixel.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM6kAAAAASUVORK5CYII=", "base64"));
for (const name of ["media.html", "compositions/media-scene.html", "compositions/media-leaf.html"]) {
	await copyFile(join(dirname(fileURLToPath(import.meta.url)), "hyperframes", name), join(project, name));
	files.push(name);
}
await writeFile(join(project, "assets/fast.webm"), await nativeVideoFixture(100));
files.push("assets/fast.webm");
for (const [name, html] of Object.entries(hyperframesMediaVariants(await readFile(join(project, "media.html"), "utf8")))) {
	await writeFile(join(project, name), html, "utf8");
	files.push(name);
}
await writeFile(join(staging, "compile.json"), JSON.stringify({
	version: 1, engine: "hyperframes", sourceDirectory: project, entryFile: "index.html", files,
	width: 64, height: 64, frameRate: { numerator: 30, denominator: 1 }, durationFrames: 60, seed: 7,
}), "utf8");
await writeFile(join(staging, "media-compile.json"), JSON.stringify({
	version: 1, engine: "hyperframes", sourceDirectory: project, entryFile: "media.html", files,
	width: 64, height: 64, frameRate: { numerator: 100, denominator: 1 }, durationFrames: 200, seed: 7,
}), "utf8");
