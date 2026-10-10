import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { bubbleHostAtomicBatch } from "./bubble-host-cases.mjs";
import { bubbleHostFields, bubbleHostSentinel } from "./bubble-host-contract.mjs";
import { bubbleHostDigest } from "./bubble-host-source.mjs";

export function assertBubbleHostCatalog(catalog) {
	assert(Array.isArray(catalog.effects.bubble), "Current Host lacks Bubble");
	const fields = catalog.effects.bubble.map((field) => Object.fromEntries(
		Object.keys(bubbleHostFields[0]).map((key) => [key, key === "required" ? field[key] ?? null : field[key]])));
	assert.deepEqual(fields, bubbleHostFields);
	assert.equal(fields.length, 76);
	assert.equal(fields.filter((field) => field.keyframable).length, 21);
	return fields;
}
export function assertBubbleHostAuthored({ snapshot, clips }) {
	assert.equal(snapshot.clips.length, clips.length);
	for (const expected of clips) {
		const actual = snapshot.clips.find((clip) => clip.id === expected.id);
		assert(actual, `Missing clip ${expected.id}`);
		for (const key of Object.keys(expected)) assert.deepEqual(actual[key], expected[key], `${expected.id}.${key}`);
	}
}
export function bubbleHostClient({ editorUrl, projectRoot }) {
	let callIndex = 0;
	const requestLog = [];
	const raw = async (route, body) => {
		const response = await fetch(new URL(`api/${route}`, editorUrl()), {
			signal: AbortSignal.timeout(15000), ...(body === undefined ? {} : {
				method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
		});
		const bytes = Buffer.from(await response.arrayBuffer());
		const name = `http-${String(++callIndex).padStart(4, "0")}`;
		const diagnostic = { route, request: body ?? null, status: response.status,
			response: route.endsWith("/load") ? { bytes: bytes.length, sha256: bubbleHostDigest(bytes) }
				: JSON.parse(bytes.toString("utf8")) };
		await writeFile(join(projectRoot, "..", name + ".json"), JSON.stringify(diagnostic) + "\n", { flag: "wx" });
		requestLog.push({ name, route, status: response.status });
		return { status: response.status, bytes, json: () => JSON.parse(bytes.toString("utf8")) };
	};
	const request = async (route, body) => {
		const response = await raw(route, body), result = response.json();
		assert.equal(response.status, 200, JSON.stringify(result)); return result;
	};
	const context = () => request("context");
	const snapshot = async () => {
		const current = await context(), clips = await request("clips"), tracks = await request("tracks");
		const byId = (a, b) => a.id.localeCompare(b.id);
		return { project: current.project, revision: current.revision, clips: clips.sort(byId), tracks: tracks.sort(byId) };
	};
	const disk = () => readFile(join(projectRoot, "project.json"));
	const accept = async (operations) => {
		const before = await context(), result = await request("apply", { expectedRevision: before.revision, operations });
		assert.equal(result.accepted, true);
		assert.equal((await context()).revision, before.revision + 1); return result;
	};
	const reject = async (invalid) => {
		const before = await snapshot(), bytes = await disk();
		const sentinel = before.clips.find((clip) => clip.id === bubbleHostSentinel); assert(sentinel);
		const body = { expectedRevision: before.revision, operations: bubbleHostAtomicBatch({ invalid, sentinel }) };
		const response = await raw("apply", body), result = response.json();
		const after = await snapshot(), afterBytes = await disk();
		const diagnostic = { label: invalid.label, status: response.status, request: body, response: result,
			before: { revision: before.revision, projectSha256: bubbleHostDigest(bytes), snapshotSha256: bubbleHostDigest(JSON.stringify(before)) },
			after: { revision: after.revision, projectSha256: bubbleHostDigest(afterBytes), snapshotSha256: bubbleHostDigest(JSON.stringify(after)) },
			memoryUnchanged: isDeepStrictEqual(after, before), persistedBytesUnchanged: afterBytes.equals(bytes),
			sentinelSha256: bubbleHostDigest(JSON.stringify(sentinel)) };
		const diagnosticFile = `rejection-${bubbleHostDigest(invalid.label).slice(0, 20)}.json`;
		await writeFile(join(projectRoot, "..", diagnosticFile), JSON.stringify(diagnostic, null, 2) + "\n", { flag: "wx" });
		assert.equal(response.status, 409, invalid.label); assert.equal(result.accepted, false, invalid.label);
		assert.deepEqual(after, before, `${invalid.label}: memory changed`);
		assert.deepEqual(afterBytes, bytes, `${invalid.label}: disk changed`);
		assert.equal(typeof result.message, "string", invalid.label);
		return { label: invalid.label, status: response.status, revision: before.revision,
			projectSha256: diagnostic.before.projectSha256, sentinelSha256: diagnostic.sentinelSha256,
			memoryUnchanged: true, persistedBytesUnchanged: true, diagnosticFile };
	};
	return { raw, request, context, snapshot, disk, accept, reject, requestLog };
}
