import { expect, test } from "bun:test";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { clipId, trackId, mediaTime, revisionOf } from "@opencut/editor-contracts";
import { startHost } from "../host";
import { TargetRegistry } from "../target-registry";
import { prepareRemotionProbe } from "../../../../script/fixtures/prepare-remotion-probe";

const toolchain = process.env.ROCUT_TEST_REMOTION_TOOLCHAIN;
test.skipIf(!toolchain)("native Remotion compile archives declared TSX/assets and survives editing/restart/rebuild", async () => {
	const parent = path.resolve(tmpdir()), root = await mkdtemp(path.join(parent, "rocut-remotion-test-"));
	const spec = await prepareRemotionProbe(path.join(root, "author"));
	const options = { projectRoot: path.join(root, "target"), registry: new TargetRegistry(path.join(root, "registry")),
		engineToolchainDirectory: toolchain, htmlBrowserExecutable: "", htmlFrameConnectionFile: "" };
	let host = await startHost(options);
	const api = (route: string) => new URL(`api/${route}`, host.editorUrl);
	const post = async (action: string, input: unknown) => fetch(api(`programmatic/build/${action}`), { method: "POST", body: JSON.stringify(input) });
	try {
		const response = await post("compile", spec), result = await response.json();
		if (response.status !== 200) throw Error(JSON.stringify(result));
		expect(result.source.build).toMatchObject({ engine: "remotion", engineVersion: "4.0.440", compositionId: "Rocut", inputProps: spec.inputProps });
		expect(result.source.build.inputs).toHaveLength(9);
		const lockResponse = await fetch(api("programmatic/resources/load"), { method: "POST", body: JSON.stringify(result.source.build.toolchainLock) });
		const lock = await lockResponse.json();
		expect(lock.adapter).toMatchObject({ id: "rocut-remotion-html", version: 1, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
		const olderLockPath = path.join(root, "older-lock.json");
		await writeFile(olderLockPath, JSON.stringify({ version: 1, packages: lock.packages }));
		const importedLock = await fetch(api("programmatic/resources/import"), { method: "POST", body: JSON.stringify({
			filePath: olderLockPath, id: result.source.build.toolchainLock.id, kind: "source", mimeType: "application/octet-stream",
		}) });
		expect(importedLock.status).toBe(200);
		const old = await post("rebuild", { ...result.source, build: { ...result.source.build, toolchainLock: (await importedLock.json()).resource } });
		expect(old.status).toBe(422);
		expect(await old.text()).toContain("Archived toolchain differs");
		const document = await fetch(api("programmatic/resources/load"), { method: "POST", body: JSON.stringify(result.source.resources[0]) });
		const html = await document.text();
		expect(html).toContain("__rocutRenderRemotionFrame");
		expect(html).not.toContain(spec.sourceDirectory);
		expect(html).not.toContain(toolchain!);
		expect(html).not.toContain('"unsafeText":"</script>"');
		const missing = await post("compile", { ...spec, files: spec.files.filter(f => f !== "src/delayed.tsx") });
		expect(missing.status).toBe(422);
		const external = path.join(spec.sourceDirectory, "escape.tsx");
		await writeFile(external, "import 'node:fs';");
		expect((await post("compile", { ...spec, entryFile: "escape.tsx", files: ["escape.tsx"] })).status).toBe(422);
		expect((await post("compile", { ...spec, compositionId: "../bad" })).status).toBe(422);
		expect((await post("compile", { ...spec, inputProps: null })).status).toBe(422);
		const context = await (await fetch(api("context"))).json();
		await host.automation.apply({ expectedRevision: revisionOf(context.revision), operations: [
			{ kind: "create-track", track: { id: trackId("remotion"), name: "Native", kind: "graphic", hidden: false } },
			{ kind: "create-clip", clip: { id: clipId("native"), trackId: trackId("remotion"), startTime: mediaTime({ ticks: 0 }),
				duration: mediaTime({ ticks: 240000 }), trimStart: mediaTime({ ticks: 0 }), trimEnd: mediaTime({ ticks: 0 }),
				editing: { type: "graphic", definitionId: "programmatic", params: {}, programmatic: result.source } } },
		] });
		await rename(spec.sourceDirectory, path.join(root, "author-removed"));
		await host.close(); host = await startHost(options);
		expect((await host.automation.clips()).find(c => c.id === "native")?.editing?.programmatic).toEqual(result.source);
		const rebuilt = await post("rebuild", result.source);
		expect(await rebuilt.json()).toEqual({ source: result.source, reusedDocument: true });
		expect(rebuilt.status).toBe(200);
	} finally {
		await host.close();
		if (path.dirname(root) !== parent || !path.basename(root).startsWith("rocut-remotion-test-")) throw Error("Unsafe fixture cleanup");
		await rm(root, { recursive: true, force: true });
	}
}, 60000);
