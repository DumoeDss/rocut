import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { importMvAudio } from "../programmatic/audio-import";
import { loadProgrammaticResource } from "../programmatic/resources";
import { FileProjectStore } from "../file-store";
import { startHost } from "../host";
import { TargetRegistry } from "../target-registry";
import { runCli } from "../main";
import { nativeAudioFixture } from "../../../../script/fixtures/mv-audio-native-fixture";

test("audio importer verifies native manifest, keeps review evidence, survives reopen and rejects corruption", async () => {
	const parent = path.resolve(tmpdir()),
		root = await mkdtemp(path.join(parent, "rocut-audio-import-"));
	try {
		const fixture = await nativeAudioFixture();
		for (const [name, body] of Object.entries(fixture.files))
			await writeFile(path.join(root, name), body, "utf8");
		const options = { root: path.join(root, "project"), schemaVersion: 1 },
			context = { store: new FileProjectStore(options), projectId: "fixture" };
		const input = {
			directory: root,
			id: "analysis/song.json",
			expectedAudioSha256: fixture.expectedAudioSha256,
			review: fixture.review,
		};
		const first = await importMvAudio({ ...context, input });
		expect(first.reused).toBe(false);
		expect(first.binding).toEqual({
			resource: input.id,
			inputSha256: fixture.expectedAudioSha256,
		});
		expect((await importMvAudio({ ...context, input })).reused).toBe(true);
		const loaded = await loadProgrammaticResource({
			...context,
			store: new FileProjectStore(options),
			resource: first.resource,
		});
		const data = JSON.parse(new TextDecoder().decode(loaded.body));
		expect(data.beats).toEqual([0, 60000, 150000]);
		expect(data.provenance.review).toEqual(fixture.review);
		expect(JSON.stringify(data)).not.toContain("DO-NOT-OPEN");
		expect(data.channels.vocal_rms).toBeUndefined();
		for (const patch of [
			{ expectedAudioSha256: "b".repeat(64) },
			{ review: { status: "required", reference: "not accepted" } },
			{ id: "../escape" },
			{ directory: "relative" },
			{ extra: true },
		])
			await expect(
				importMvAudio({ ...context, input: { ...input, ...patch } }),
			).rejects.toThrow();
		await writeFile(
			path.join(root, "music.json"),
			fixture.files["music.json"] + " ",
			"utf8",
		);
		await expect(importMvAudio({ ...context, input })).rejects.toThrow(
			"fingerprints",
		);
		await rm(path.join(root, "manifest.json"));
		await rm(path.join(root, "music.json"));
		await rm(path.join(root, "envelopes.json"));
		expect(
			Buffer.from(
				(
					await loadProgrammaticResource({
						...context,
						store: new FileProjectStore(options),
						resource: first.resource,
					})
				).body,
			),
		).toEqual(Buffer.from(loaded.body));
	} finally {
		if (
			path.dirname(root) !== parent ||
			!path.basename(root).startsWith("rocut-audio-import-")
		)
			throw Error("Unsafe fixture cleanup");
		await rm(root, { recursive: true, force: true });
	}
});

test("authenticated audio import API and real CLI prepare resources without changing project revision", async () => {
	const parent = path.resolve(tmpdir()),
		root = await mkdtemp(path.join(parent, "rocut-audio-route-"));
	const options = {
		projectRoot: path.join(root, "project"),
		registry: new TargetRegistry(path.join(root, "registry")),
		htmlBrowserExecutable: "",
		htmlFrameConnectionFile: "",
	};
	const host = await startHost(options);
	try {
		const fixture = await nativeAudioFixture();
		for (const [name, body] of Object.entries(fixture.files))
			await writeFile(path.join(root, name), body, "utf8");
		const input = {
			directory: root,
			id: "analysis/song.json",
			expectedAudioSha256: fixture.expectedAudioSha256,
			review: fixture.review,
		};
		const api = (p: string) => new URL(`api/${p}`, host.editorUrl);
		const before = await (await fetch(api("context"))).json();
		expect(before.programmaticResources.audioImport).toBe(
			"programmatic/resources/import-audio",
		);
		expect(
			(
				await fetch(
					new URL(
						"/wrong/api/programmatic/resources/import-audio",
						host.editorUrl,
					),
					{ method: "POST", body: JSON.stringify(input) },
				)
			).status,
		).toBe(401);
		const reply = await fetch(api("programmatic/resources/import-audio"), {
			method: "POST",
			body: JSON.stringify(input),
		});
		expect(reply.status).toBe(200);
		const expected = await reply.json();
		const file = path.join(root, "import.json");
		await writeFile(file, JSON.stringify(input), "utf8");
		const original = process.stdout.write;
		let stdout = "";
		process.stdout.write = ((chunk: string | Uint8Array) => {
			stdout += Buffer.from(chunk).toString("utf8");
			return true;
		}) as typeof process.stdout.write;
		try {
			await runCli([
				"programmatic",
				"audio-import",
				file,
				"--project",
				options.projectRoot,
				"--targets-root",
				path.join(root, "registry"),
			]);
		} finally {
			process.stdout.write = original;
		}
		expect(JSON.parse(stdout)).toEqual({ ...expected, reused: true });
		expect((await (await fetch(api("context"))).json()).revision).toBe(
			before.revision,
		);
	} finally {
		await host.close();
		if (
			path.dirname(root) !== parent ||
			!path.basename(root).startsWith("rocut-audio-route-")
		)
			throw Error("Unsafe fixture cleanup");
		await rm(root, { recursive: true, force: true });
	}
});
