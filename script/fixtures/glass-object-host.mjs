import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join, win32 } from "node:path";
import { pathToFileURL } from "node:url";
import { glassObjectAssets } from "./glass-object-assets.ts";
import { verifyGlassObjectPersistence } from "./glass-object-persistence.mjs";
import {
	loadGlassObjectWasm,
	checkGlassObjectWasm,
} from "./glass-object-preflight.mjs";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
export async function runGlassObjectHostProbe({
	startHost,
	TargetRegistry,
	root,
	creator,
	pkg,
	threeToolchain,
}) {
	for (const path of [root, creator, pkg, threeToolchain])
		assert(isAbsolute(path));
	const relative = win32.relative("C:/tmps", root);
	assert(relative && !relative.startsWith("..") && !win32.isAbsolute(relative));
	const wasm = await loadGlassObjectWasm(pkg),
		resolver = checkGlassObjectWasm(wasm);
	const { glassObjectThree } = await import(pathToFileURL(creator).href);
	const input = join(root, "input"),
		projectRoot = join(root, "project");
	await mkdir(input);
	const options = {
		projectRoot,
		registry: new TargetRegistry(join(root, "registry")),
		engineToolchainDirectory: threeToolchain,
		htmlBrowserExecutable: "",
		htmlFrameConnectionFile: "",
	};
	let host;
	let opened = 0,
		closed = 0;
	const open = async () => {
		host = await startHost(options);
		opened++;
	};
	const close = async () => {
		if (host) {
			await host.close();
			host = null;
			closed++;
		}
	};
	const request = async (route, body) => {
		const response = await fetch(new URL(`api/${route}`, host.editorUrl), {
			signal: AbortSignal.timeout(15000),
			...(body === undefined
				? {}
				: {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(body),
					}),
		});
		assert.equal(response.status, 200, `Glass Host ${route} status`);
		return response.json();
	};
	const graph = async () => ({
		context: await request("context"),
		clips: await request("clips"),
		tracks: await request("tracks"),
	});
	try {
		await open();
		const context = await request("context");
		assert(
			context.programmaticBuilds.configured &&
				context.programmaticBuilds.engines.some(
					(entry) => entry.engine === "three",
				),
		);
		const resources = [];
		for (const asset of glassObjectAssets()) {
			const filePath = join(input, asset.id);
			await writeFile(filePath, asset.body, { flag: "wx" });
			const { resource } = await request("programmatic/resources/import", {
				id: asset.id,
				kind: asset.kind,
				mimeType: asset.mimeType,
				filePath,
			});
			assert.equal(resource.sha256, sha(asset.body));
			assert.equal(resource.byteLength, asset.body.length);
			resources.push(resource);
		}
		const shot = await glassObjectThree({
			sourceDirectory: join(creator, ".."),
			model: resources[0],
			environment: resources[1],
			background: resources[2],
			settings: {
				width: 192,
				height: 128,
				durationFrames: 49,
				frameRate: { numerator: 24, denominator: 1 },
			},
			glass: { ior: 1.625, roughness: 0.125, dispersion: 0.125 },
			resolveParams: wasm.resolveGlassObjectParamsJson,
		});
		const compiled = await request("programmatic/build/compile", shot.spec),
			source = compiled.source;
		assert.equal(source.build.engine, "three");
		assert.equal(source.build.engineVersion, "0.185.1");
		for (const resource of resources)
			assert(
				source.resources.some(
					(item) => item.id === resource.id && item.sha256 === resource.sha256,
				),
			);
		const applied = await request("apply", {
			expectedRevision: context.revision,
			operations: [
				{
					kind: "update-project",
					projectId: context.project.id,
					patch: {
						name: "Glass Object controlled Three probe",
						canvasWidth: 192,
						canvasHeight: 128,
						frameRate: shot.spec.frameRate,
					},
				},
				{
					kind: "create-track",
					track: {
						id: "glass-track",
						name: "Glass Object",
						kind: "graphic",
						hidden: false,
					},
				},
				{
					kind: "create-clip",
					clip: {
						id: "glass-object",
						trackId: "glass-track",
						startTime: 0,
						duration: 245000,
						trimStart: 0,
						trimEnd: 0,
						editing: {
							type: "graphic",
							name: "Glass Object",
							definitionId: "programmatic",
							params: {},
							effects: shot.effects,
							programmatic: source,
						},
					},
				},
			],
		});
		assert.equal(applied.accepted, true);
		const before = await graph();
		await close();
		const beforeBytes = await readFile(join(projectRoot, "project.json"));
		await rename(input, join(root, "unavailable-input"));
		await open();
		const after = await graph();
		const attachments = await verifyGlassObjectPersistence({
			projectRoot,
			source,
			beforeBytes,
			before,
			after,
		});
		const evidence = {
			ok: true,
			resolver,
			resources,
			source,
			revision: after.context.revision,
			projectSha256: sha(beforeBytes),
			attachments,
			originalInputUnavailable: true,
			hostReopened: true,
			scope:
				"Actual private WASM resolver, real imported GLB/HDR/PNG, production controlled Three compile, Host apply/FileProjectStore reopen. No browser/GPU scene capture or pixel acceptance.",
		};
		await writeFile(
			join(root, "glass-object-host-evidence.json"),
			JSON.stringify(evidence, null, 2),
			{ flag: "wx" },
		);
		return evidence;
	} finally {
		await close();
		assert.equal(opened, closed, "Every owned Host must close");
	}
}
