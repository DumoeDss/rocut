import assert from "node:assert/strict";
import { inkHostApplyRequest } from "./ink-object-host-operations.mjs";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join, win32 } from "node:path";
import { pathToFileURL } from "node:url";
import { inkObjectGpuAssets } from "./ink-object-gpu-assets.ts";
import { verifyGlassObjectPersistence } from "./glass-object-persistence.mjs";
import {
	loadInkObjectWasm,
	checkInkObjectWasm,
} from "./ink-object-host-preflight.mjs";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
export async function runInkObjectHostProbe({
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
	const wasm = await loadInkObjectWasm(pkg),
		resolver = checkInkObjectWasm(wasm);
	const { inkObjectThree } = await import(pathToFileURL(creator).href);
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
	let host, evidence;
	const THREE = await import(
		pathToFileURL(
			join(threeToolchain, "node_modules/three/build/three.module.js"),
		).href
	);
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
		assert.equal(response.status, 200, `Ink Host ${route} status`);
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
		for (const asset of inkObjectGpuAssets(THREE)) {
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
		const shot = await inkObjectThree({
			sourceDirectory: join(creator, ".."),
			model: resources[0],
			environment: resources[1],
			settings: {
				width: 192,
				height: 128,
				durationFrames: 49,
				frameRate: { numerator: 24, denominator: 1 },
			},
			ink: {
				contourWidth: 4,
				inkDensity: 0.85,
				paperTexture: 0.65,
				paperScale: 12,
				seed: 19,
			},
			resolveParams: wasm.resolveInkObjectParamsJson,
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
		const applied = await request(
			"apply",
			inkHostApplyRequest(context, shot, source),
		);
		assert.equal(applied.accepted, true);
		const before = await graph();
		await close();
		const beforeBytes = await readFile(join(projectRoot, "project.json"));
		const backup = join(root, "unavailable-input");
		for (const path of [input, backup]) {
			const rel = win32.relative(root, path);
			assert(
				isAbsolute(path) &&
					rel &&
					!rel.startsWith("..") &&
					!win32.isAbsolute(rel),
			);
		}
		await rename(input, backup);
		for (const resource of resources)
			assert.equal(
				sha(await readFile(join(backup, resource.id))),
				resource.sha256,
			);
		await open();
		const after = await graph();
		const attachments = await verifyGlassObjectPersistence({
			projectRoot,
			source,
			beforeBytes,
			before,
			after,
		});
		evidence = {
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
				"Actual private WASM resolver, diagnostic embedded map/normal GLB and HDR, production controlled Three compile, Host apply/FileProjectStore reopen. Not UI history; no browser/GPU scene capture or pixel acceptance.",
		};
		return evidence;
	} finally {
		await close();
		assert.equal(opened, closed, "Every owned Host must close");
		if (evidence) {
			evidence.cleanup = {
				opened,
				closed,
				hostClosed: host === null,
				browserStarted: false,
				gpuStarted: false,
				deleted: [],
			};
			await writeFile(
				join(root, "ink-object-host-evidence.json"),
				JSON.stringify(evidence, null, 2),
				{ flag: "wx" },
			);
		}
	}
}
