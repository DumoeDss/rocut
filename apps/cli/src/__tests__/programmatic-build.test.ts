import { expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { clipId, trackId, mediaTime, revisionOf } from "@opencut/editor-contracts";
import { startHost } from "../host";
import { TargetRegistry } from "../target-registry";
import { runCli } from "../main";
import { parseCompileInput } from "../programmatic/engines/build-source";
import { snapshotSourceFiles } from "../programmatic/engines/source-snapshot";
import { runCompilerChild } from "../programmatic/engines/compiler-process";
import { nativeVideoFixture } from "../../../../script/fixtures/native-video-fixture.mjs";

const fixtureRoot = path.resolve(import.meta.dir, "../../../../script/fixtures/hyperframes");
const baseSpec = {
	version: 1, engine: "hyperframes", entryFile: "index.html", files: ["index.html"],
	width: 64, height: 64, frameRate: { numerator: 30, denominator: 1 }, durationFrames: 60, seed: 7,
};
async function cleanup(root: string) {
	if (path.dirname(root) !== path.resolve(tmpdir()) || !path.basename(root).startsWith("rocut-build-test-"))
		throw Error("Unsafe build fixture cleanup");
	await rm(root, { recursive: true, force: true });
}

test("Rust rejects unsafe archive plans before filesystem access; snapshot rejects junction escape", async () => {
	for (const files of [["../secret"], ["index.html", "INDEX.html"], ["CON.js"], ["a", "a/b"], ["node_modules/pkg.js"]])
		expect(() => parseCompileInput({ ...baseSpec, sourceDirectory: "C:/not-read", files })).toThrow();
	const root = await mkdtemp(path.join(tmpdir(), "rocut-build-test-"));
	try {
		await mkdir(path.join(root, "author")); await mkdir(path.join(root, "outside"));
		await writeFile(path.join(root, "outside/index.html"), "<div>not declared in root</div>");
		await symlink(path.join(root, "outside"), path.join(root, "author/link"), "junction");
		const parsed = parseCompileInput({ ...baseSpec, sourceDirectory: path.join(root, "author"), entryFile: "link/index.html", files: ["link/index.html"] });
		await expect(snapshotSourceFiles(parsed.sourceDirectory, parsed.source, new AbortController().signal)).rejects.toThrow("symlinks");
	} finally { await cleanup(root); }
});

test("cancellation terminates a non-cooperating compiler child and permits a fresh request", async () => {
	const controller = new AbortController();
	const pending = runCompilerChild({ compilerEntry: "data:text/javascript,while(true){}" }, controller.signal);
	const timer = setTimeout(() => controller.abort(), 150);
	try { await expect(pending).rejects.toThrow("cancelled"); } finally { clearTimeout(timer); }
	await expect(runCompilerChild({ compilerEntry: "data:text/javascript,throw Error('fresh-child')" }, new AbortController().signal)).rejects.toThrow("fresh-child");
});

test("compiler capability is explicit, unavailable without a configured toolchain, and authenticated", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "rocut-build-test-"));
	const host = await startHost({ projectRoot: path.join(root, "project"), registry: new TargetRegistry(path.join(root, "registry")), engineToolchainDirectory: "" });
	try {
		const context = await (await fetch(new URL("api/context", host.editorUrl))).json();
		expect(context.programmaticBuilds.configured).toBe(false);
		expect((await fetch(new URL("api/programmatic/build/compile", host.editorUrl), { method: "POST", body: "{}" })).status).toBe(503);
		expect((await fetch(new URL("/wrong/api/programmatic/build/compile", host.editorUrl), { method: "POST", body: "{}" })).status).toBe(401);
	} finally { await host.close(); await cleanup(root); }
});

const toolchain = process.env.ROCUT_TEST_ENGINE_TOOLCHAIN;
test.skipIf(!toolchain)("real Agent compile archives sources; restart/rebuild needs no original directory and preserves output digest", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "rocut-build-test-"));
	const author = path.join(root, "author");
	const options = { projectRoot: path.join(root, "project"), registry: new TargetRegistry(path.join(root, "registry")), engineToolchainDirectory: toolchain, htmlBrowserExecutable: "", htmlFrameConnectionFile: "" };
	let host = await startHost(options);
	const api = (route: string) => new URL(`api/${route}`, host.editorUrl);
	const post = async (action: string, input: unknown) => fetch(api(`programmatic/build/${action}`), { method: "POST", body: JSON.stringify(input) });
	try {
		await mkdir(path.join(author, "compositions"), { recursive: true });
		const files = ["index.html", "compositions/scene.html", "compositions/leaf.html", "gsap.js", "empty.css", "assets/font.ttf", "assets/pixel.png", "assets/frames.webm"];
		for (const file of files.slice(0, 3)) await copyFile(path.join(fixtureRoot, file), path.join(author, file));
		await copyFile(path.join(toolchain!, "node_modules/gsap/dist/gsap.min.js"), path.join(author, "gsap.js"));
		await writeFile(path.join(author, "empty.css"), "");
		await mkdir(path.join(author, "assets"));
		await copyFile(path.resolve(fixtureRoot, "../../../apps/web/public/motion-text/fonts/ibm-plex-mono-medium.ttf"), path.join(author, "assets/font.ttf"));
		await writeFile(path.join(author, "assets/pixel.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM6kAAAAASUVORK5CYII=", "base64"));
		await writeFile(path.join(author, "assets/frames.webm"), await nativeVideoFixture());
		const entry = await readFile(path.join(author, "index.html"), "utf8");
		await writeFile(path.join(author, "index.html"), entry.replace('<div id="marker"></div>',
			'<div id="marker"></div><video id="archive-video" muted playsinline src="assets/frames.webm" data-start="0" data-duration="2" data-track-index="9"></video>'));
		const spec = { ...baseSpec, files, sourceDirectory: author };
		const before = await (await fetch(api("context"))).json();
		expect(before.programmaticBuilds.engines).toContainEqual({ engine: "hyperframes", version: "0.8.139" });
		expect((await fetch(new URL("/wrong/api/programmatic/build/compile", host.editorUrl), { method: "POST", body: JSON.stringify(spec) })).status).toBe(401);
		const response = await post("compile", spec), initial = await response.json();
		if (response.status !== 200) throw Error(JSON.stringify(initial));
		expect(initial.source.build.inputs).toHaveLength(8);
		expect(initial.source.build.inputs.some((r: { id: string }) => r.id === "assets/frames.webm")).toBe(true);
		expect(initial.source.build.inputs.find((r: { id: string }) => r.id === "empty.css").byteLength).toBe(0);
		expect(initial.source.resources[0].byteLength).toBeGreaterThan(262144);
		const compiled = await fetch(api("programmatic/resources/load"), { method: "POST", body: JSON.stringify(initial.source.resources[0]) });
		expect(await compiled.text()).toContain("data:video/webm;base64,");
		const specPath = path.join(root, "compile.json");
		await writeFile(specPath, JSON.stringify(spec));
		const originalWrite = process.stdout.write;
		let stdout = "";
		process.stdout.write = ((chunk: string | Uint8Array) => { stdout += Buffer.from(chunk).toString("utf8"); return true; }) as typeof process.stdout.write;
		try { await runCli(["programmatic", "compile", specPath, "--project", options.projectRoot, "--targets-root", path.join(root, "registry")]); }
		finally { process.stdout.write = originalWrite; }
		expect(JSON.parse(stdout)).toEqual({ source: initial.source, reusedDocument: true });
		const missing = await post("compile", { ...spec, files: files.filter(f => f !== "compositions/leaf.html") });
		expect(missing.status).toBe(422);
		const wrongSize = await post("compile", { ...spec, width: 65 });
		expect(wrongSize.status).toBe(422);
		expect(await wrongSize.text()).toContain("dimensions/duration");
		await writeFile(path.join(author, "broken.html"), Buffer.from([0xc3, 0x28]));
		expect((await post("compile", { ...spec, files: ["broken.html"], entryFile: "broken.html" })).status).toBe(422);
		expect((await (await fetch(api("context"))).json()).revision).toBe(before.revision);
		await host.automation.apply({ expectedRevision: revisionOf(before.revision), operations: [
			{ kind: "create-track", track: { id: trackId("native-track"), name: "Native", kind: "graphic", hidden: false } },
			{ kind: "create-clip", clip: { id: clipId("native-clip"), trackId: trackId("native-track"),
				startTime: mediaTime({ ticks: 0 }), duration: mediaTime({ ticks: 240000 }), trimStart: mediaTime({ ticks: 0 }), trimEnd: mediaTime({ ticks: 0 }),
				editing: { type: "graphic", definitionId: "programmatic", params: {}, programmatic: initial.source },
			} },
		] });
		await rename(author, path.join(root, "author-unavailable"));
		await host.close(); host = await startHost(options);
		expect((await host.automation.clips()).find(c => c.id === "native-clip")?.editing?.programmatic).toEqual(initial.source);
		const rebuild = await post("rebuild", initial.source), rebuilt = await rebuild.json();
		if (rebuild.status !== 200) throw Error(JSON.stringify(rebuilt));
		expect(rebuilt).toEqual({ source: initial.source, reusedDocument: true });
		expect((await (await fetch(api("context"))).json()).revision).toBe(before.revision + 1);
		const lock = await fetch(api("programmatic/resources/load"), { method: "POST", body: JSON.stringify(initial.source.build.toolchainLock) });
		const lockText = await lock.text();
		expect(lockText).not.toContain("https://"); expect(lockText).not.toContain(toolchain!);
		const lockData = JSON.parse(lockText);
		expect(lockData.adapter).toMatchObject({ id: "rocut-hyperframes-html", version: 1, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
		for (const adapter of [undefined, { ...lockData.adapter, sha256: "0".repeat(64) }]) {
			const olderLockPath = path.join(root, "older-lock.json");
			await writeFile(olderLockPath, JSON.stringify({ version: 1, packages: lockData.packages, adapter }));
			const imported = await fetch(api("programmatic/resources/import"), { method: "POST", body: JSON.stringify({
				filePath: olderLockPath, id: initial.source.build.toolchainLock.id, kind: "source", mimeType: "application/octet-stream",
			}) });
			expect(imported.status).toBe(200);
			const outdated = await post("rebuild", { ...initial.source, build: { ...initial.source.build, toolchainLock: (await imported.json()).resource } });
			expect(outdated.status).toBe(422);
			expect(await outdated.text()).toContain("Archived toolchain differs");
		}
		const lockResource = initial.source.build.toolchainLock;
		const corrupted = new Uint8Array(lockResource.byteLength);
		await fetch(api(`attachment/${lockResource.attachmentKey}`), {
			method: "PUT", headers: { "x-opencut-metadata": Buffer.from(JSON.stringify({ ...lockResource, kind: "programmatic-resource", version: 1 })).toString("base64") }, body: corrupted,
		});
		const tampered = await post("rebuild", initial.source);
		expect(tampered.status).toBe(422);
		expect(await tampered.text()).toContain("integrity mismatch");
	} finally { await host.close(); await cleanup(root); }
}, 60000);
