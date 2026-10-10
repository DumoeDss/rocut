import assert from "node:assert/strict";
import { mkdir, readFile, rename, writeFile, lstat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import {
	bubbleEditorContract as spec,
	bubbleEditorClips,
} from "./bubble-editor-contract.mjs";
import {
	validateBubbleEditorInputs,
	verifyBubbleEditorInputs,
} from "./bubble-editor-provenance.mjs";
import {
	bubbleExportHash as hash,
	bubbleExportSave as save,
	bubbleExportScratch,
} from "./bubble-export-preflight.mjs";
import { bubbleExportSource } from "./bubble-export-reference.mjs";
import { blazePipelinePng } from "../probe-blaze-pipeline-png.mjs";
import {
	blazeEditorRequest as makeRequest,
	blazeEditorSnapshot as snapshot,
} from "./blaze-editor-control.mjs";
import { blazeEditorRedact as redact } from "./blaze-editor-lifecycle.mjs";

export async function runBubbleEditorHost(root, configPath) {
	const ownPath = fileURLToPath(
		new URL("../probe-bubble-editor.mjs", import.meta.url),
	);
	const { config, inputs, provenance } = await validateBubbleEditorInputs(
		configPath,
		ownPath,
	);
	await bubbleExportScratch(root);
	await assert.rejects(lstat(join(root, "project")), { code: "ENOENT" });
	const { startHost } = await import(
		pathToFileURL(join(config.snapshot, "apps/cli/src/host.ts")).href
	);
	const { TargetRegistry } = await import(
		pathToFileURL(join(config.snapshot, "apps/cli/src/target-registry.ts")).href
	);
	const creator = await import(pathToFileURL(config.creatorModule).href);
	const options = {
		projectRoot: join(root, "project"),
		staticDir: config.editorDist,
		port: 0,
		registry: new TargetRegistry(join(root, "registry")),
		htmlBrowserExecutable: "",
		htmlFrameConnectionFile: "",
	};
	let host;
	const lifecycle = { hostClosed: false, reopened: false };
	const close = async () => {
		if (host) {
			await host.close();
			host = undefined;
		}
	};
	try {
		host = await startHost(options);
		let request = makeRequest(host.editorUrl);
		const author = join(root, "author");
		await mkdir(author);
		const png = blazePipelinePng(bubbleExportSource(), spec.width, spec.height),
			filePath = join(author, "bubble.png");
		await writeFile(filePath, png, { flag: "wx" });
		const { resource } = await request("programmatic/resources/import", {
			id: "bubble.png",
			filePath,
			kind: "image",
			mimeType: "image/png",
		});
		assert.equal(resource.sha256, hash(png));
		const catalog = await request("editing/catalog"),
			context = await request("context");
		const clips = bubbleEditorClips(creator, resource, catalog);
		assert.equal(clips[0].editing.effects[0].params.pointCount, 1);
		const accepted = await request("apply", {
			expectedRevision: context.revision,
			operations: [
				{
					kind: "update-project",
					projectId: context.project.id,
					patch: {
						name: "Bubble isolated real UI acceptance",
						canvasWidth: spec.width,
						canvasHeight: spec.height,
						frameRate: spec.frameRate,
						background: { type: "color", color: "#000000" },
					},
				},
				{
					kind: "create-track",
					track: {
						id: spec.graphicTrack,
						name: "Bubble UI graphics",
						hidden: false,
						kind: "graphic",
					},
				},
				{
					kind: "create-track",
					track: {
						id: spec.effectTrack,
						name: "Bubble UI standalone",
						hidden: false,
						kind: "effect",
					},
				},
				...clips.map((clip) => ({ kind: "create-clip", clip })),
			],
		});
		assert(accepted.accepted);
		const initial = await snapshot(request),
			seed = await readFile(join(root, "project/project.json"));
		await rename(author, join(root, "unavailable-author"));
		await close();
		host = await startHost(options);
		request = makeRequest(host.editorUrl);
		assert.deepEqual(await snapshot(request), initial);
		assert.deepEqual(await readFile(join(root, "project/project.json")), seed);
		const verifyResource = async () => {
			const response = await fetch(
				new URL("api/programmatic/resources/load", host.editorUrl),
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(resource),
					signal: AbortSignal.timeout(15000),
				},
			);
			assert.equal(response.status, 200);
			assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
		};
		await verifyResource();
		await save(root, "prepared.json", {
			snapshot: initial,
			resource,
			authorUnavailable: true,
			provenance,
		});
		await save(root, "project-before-ui.json", seed);
		console.log(JSON.stringify({ editorUrl: host.editorUrl }));
		const command = await new Promise((done) => {
			process.stdin.once("data", (data) => done(data.toString().trim()));
			process.stdin.once("end", () => done("stop"));
		});
		if (command === "verify") {
			const expected = JSON.parse(
					await readFile(join(root, "expected-edited.json"), "utf8"),
				),
				finalBytes = await readFile(join(root, "project-final-ui.json"));
			assert.deepEqual(await snapshot(request), expected);
			assert.deepEqual(
				await readFile(join(root, "project/project.json")),
				finalBytes,
			);
			await close();
			host = await startHost(options);
			request = makeRequest(host.editorUrl);
			assert.deepEqual(await snapshot(request), expected);
			assert.deepEqual(
				await readFile(join(root, "project/project.json")),
				finalBytes,
			);
			await verifyResource();
			await save(root, "reopened-after-ui.json", {
				ok: true,
				snapshot: expected,
				projectSha256: hash(finalBytes),
				byteIdentical: true,
				resourceStillAvailable: true,
			});
			lifecycle.reopened = true;
		}
		await verifyBubbleEditorInputs(inputs);
	} catch (error) {
		lifecycle.failure = redact(error.stack ?? error);
		throw error;
	} finally {
		try {
			await close();
			lifecycle.hostClosed = true;
		} finally {
			await save(root, "host-lifecycle.json", lifecycle);
		}
	}
}
