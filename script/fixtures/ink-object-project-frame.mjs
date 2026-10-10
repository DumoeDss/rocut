import assert from "node:assert/strict";
import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { startHost } from "../../apps/cli/src/host.ts";
import { TargetRegistry } from "../../apps/cli/src/target-registry.ts";
import {
	pngPixels,
	pixelComparison,
	visibility,
} from "./liquid-object-capture-probe-pixels.mjs";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
export async function runInkProjectFrame({
	root,
	original,
	executable,
	threeToolchain,
}) {
	const projectRoot = join(original, "project"),
		report = {
			ok: false,
			frames: [],
			scope:
				"Actual unchanged persisted Ink project through Host programmatic/frame -> production renderHtmlPng; not UI history/export/shader matrix",
		};
	const evidence = JSON.parse(
		await readFile(join(original, "evidence.json"), "utf8"),
	);
	assert(evidence.ok && evidence.host.ok);
	await assert.rejects(access(join(original, "input")));
	const beforeBytes = await readFile(join(projectRoot, "project.json"));
	assert.equal(sha(beforeBytes), evidence.host.projectSha256);
	const source = evidence.host.source;
	assert.deepEqual(source.build.inputProps.rotationSpeed, [0, 0, 0]);
	const archived = [];
	for (const item of [
		...source.resources,
		...source.build.inputs,
		source.build.toolchainLock,
	]) {
		const bytes = await readFile(
			join(projectRoot, "attachments", item.attachmentKey, "body.bin"),
		);
		assert.equal(sha(bytes), item.sha256);
		assert.equal(bytes.length, item.byteLength);
		archived.push({
			path: join(projectRoot, "attachments", item.attachmentKey, "body.bin"),
			sha256: item.sha256,
			bytes: bytes.length,
		});
	}
	const glb = await readFile(
		archived.find((x) =>
			x.path.includes(
				source.resources.find((x) => x.kind === "model").attachmentKey,
			),
		).path,
	);
	const model = JSON.parse(
		glb.subarray(20, 20 + glb.readUInt32LE(12)).toString("utf8"),
	);
	assert(
		model.materials[0].pbrMetallicRoughness.baseColorTexture &&
			model.materials[0].normalTexture,
	);
	assert(
		model.images.every(
			(x) => Number.isInteger(x.bufferView) && x.mimeType === "image/png",
		),
	);
	report.resources = {
		archiveVerified: archived,
		embeddedMapAndNormal: true,
		originalInputUnavailable: true,
	};
	let host;
	try {
		host = await startHost({
			projectRoot,
			registry: new TargetRegistry(join(root, "registry")),
			engineToolchainDirectory: threeToolchain,
			htmlBrowserExecutable: executable,
			htmlFrameConnectionFile: "",
		});
		const request = async (route, body) =>
			fetch(new URL(`api/${route}`, host.editorUrl), {
				signal: AbortSignal.timeout(30000),
				...(body === undefined
					? {}
					: {
							method: "POST",
							headers: { "content-type": "application/json" },
							body: JSON.stringify(body),
						}),
			});
		const graph = async () => {
			const result = {};
			for (const route of ["context", "clips", "tracks"]) {
				const r = await request(route);
				assert.equal(r.status, 200);
				result[route] = await r.json();
			}
			return result;
		};
		const before = await graph(),
			clip = before.clips.find((x) => x.id === "ink-object");
		assert(clip);
		assert.deepEqual(clip.editing.programmatic, source);
		const captures = [];
		for (const timelineTime of [30000, 180000, 30000]) {
			const response = await request("programmatic/frame", {
				source: clip.editing.programmatic,
				clipStart: clip.startTime,
				clipDuration: clip.duration,
				trimStart: clip.trimStart,
				timelineTime,
			});
			if (response.status !== 200)
				throw Error(`Host frame ${response.status}: ${await response.text()}`);
			assert.equal(response.headers.get("content-type"), "image/png");
			const png = Buffer.from(await response.arrayBuffer()),
				image = pngPixels(png),
				path = join(root, `frame-${captures.length}.png`);
			assert.equal(image.width, 192);
			assert.equal(image.height, 128);
			assert(visibility(image).changedPixels > 200);
			await writeFile(path, png, { flag: "wx" });
			captures.push({ png, image });
			report.frames.push({
				timelineTime,
				path,
				bytes: png.length,
				sha256: sha(png),
				visibility: visibility(image),
			});
		}
		report.timeComparison = pixelComparison({
			a: captures[0].image,
			b: captures[1].image,
		});
		assert(
			captures[0].png.equals(captures[2].png),
			"Late -> reverse seek changed original frame bytes",
		);
		report.reverseSeekExact = true;
		report.motion = {
			present: false,
			expected:
				"Persisted rotationSpeed is zero; static original source is not claimed as motion acceptance",
		};
		const derived = {
			...source,
			build: {
				...source.build,
				inputProps: { ...source.build.inputProps, rotationSpeed: [0, 0.6, 0] },
			},
		};
		const response = await request("programmatic/frame", {
			source: derived,
			clipStart: clip.startTime,
			clipDuration: clip.duration,
			trimStart: clip.trimStart,
			timelineTime: 180000,
		});
		report.derivedRequest = {
			status: response.status,
			rotationSpeed: [0, 0.6, 0],
			scope:
				"Request-only build metadata parameter sensitivity; original archived compiled HTML and project not modified",
		};
		if (response.status === 200) {
			const png = Buffer.from(await response.arrayBuffer()),
				image = pngPixels(png),
				path = join(root, "frame-derived.png");
			await writeFile(path, png, { flag: "wx" });
			report.derivedRequest.capture = {
				path,
				sha256: sha(png),
				bytes: png.length,
				comparison: pixelComparison({ a: captures[1].image, b: image }),
			};
			report.derivedRequest.originalLateBytesEqual = png.equals(
				captures[1].png,
			);
		} else report.derivedRequest.rejection = await response.text();
		const after = await graph();
		assert.deepEqual(after, before);
		report.graph = before;
		assert(
			(await readFile(join(projectRoot, "project.json"))).equals(beforeBytes),
		);
		for (const item of archived)
			assert.equal(sha(await readFile(item.path)), item.sha256);
		report.projectSha256 = sha(beforeBytes);
		report.projectGraphRevisionAttachmentsUnchanged = true;
		report.ok = true;
	} finally {
		if (host) {
			await host.close();
			report.hostClosed = true;
		}
		await writeFile(
			join(root, "frame-evidence.json"),
			JSON.stringify(report, null, 2),
			{ flag: "wx" },
		);
	}
	return report;
}
