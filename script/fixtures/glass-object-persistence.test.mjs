import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { verifyGlassObjectPersistence } from "./glass-object-persistence.mjs";
async function fixture() {
	const projectRoot = await mkdtemp("C:/tmps/glass-object-persistence-cpu-"),
		body = Buffer.from("CPU integrity bytes, not a GLB or render oracle");
	const hash = createHash("sha256").update(body).digest("hex"),
		attachmentKey = `programmatic-sha256-${hash}`;
	const directory = join(projectRoot, "attachments", attachmentKey);
	await mkdir(directory, { recursive: true });
	const bodyPath = join(directory, "body.bin");
	await writeFile(bodyPath, body);
	const beforeBytes = Buffer.from('{"cpuFixture":true}');
	await writeFile(join(projectRoot, "project.json"), beforeBytes);
	const resource = {
		id: "cpu-only",
		attachmentKey,
		byteLength: body.length,
		sha256: hash,
	};
	const before = {
		clips: [],
		tracks: [],
		context: { project: { id: "cpu" }, revision: 1 },
	};
	return {
		projectRoot,
		bodyPath,
		source: {
			resources: [resource],
			build: { inputs: [], toolchainLock: resource },
		},
		beforeBytes,
		before,
		after: structuredClone(before),
	};
}
test("unchanged persistence verifies resource and toolchain lock attachment hashes", async () => {
	const f = await fixture();
	const result = await verifyGlassObjectPersistence(f);
	assert.equal(result.length, 2);
	assert.equal(result[0].sha256, f.source.resources[0].sha256);
});
test("corrupt bytes and graph revision drift are rejected rather than repaired", async () => {
	const f = await fixture();
	await writeFile(f.bodyPath, "corrupted");
	await assert.rejects(verifyGlassObjectPersistence(f));
	const other = await fixture();
	other.after.context.revision = 2;
	await assert.rejects(verifyGlassObjectPersistence(other));
});
test("map enumeration order changes preserve graph but field mutations do not", async () => {
	const f = await fixture();
	f.before.tracks = [{ id: "b", kind: "video" }, { id: "a", kind: "graphic" }];
	f.after.tracks = [...f.before.tracks].reverse();
	await verifyGlassObjectPersistence(f);
	f.after.tracks = [{ id: "a", kind: "video" }, { id: "b", kind: "video" }];
	await assert.rejects(verifyGlassObjectPersistence(f));
});
test("duplicate graph identifiers are rejected", async () => {
	const f = await fixture();
	f.before.tracks = f.after.tracks = [{ id: "a" }, { id: "a" }];
	await assert.rejects(verifyGlassObjectPersistence(f));
});
test("source inputs use the production source attachment namespace", async () => {
	const f = await fixture();
	const source = { ...f.source.resources[0], kind: "source" };
	source.attachmentKey = `programmatic-source-sha256-${source.sha256}`;
	const directory = join(f.projectRoot, "attachments", source.attachmentKey);
	await mkdir(directory); await writeFile(join(directory, "body.bin"), await readFile(f.bodyPath));
	f.source.build.inputs = [source]; f.source.build.toolchainLock = source;
	assert.equal((await verifyGlassObjectPersistence(f)).length, 3);
	source.attachmentKey = `programmatic-sha256-${source.sha256}`;
	await assert.rejects(verifyGlassObjectPersistence(f));
});
