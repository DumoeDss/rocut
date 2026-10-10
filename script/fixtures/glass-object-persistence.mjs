import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
export async function verifyGlassObjectPersistence({
	projectRoot,
	source,
	beforeBytes,
	before,
	after,
}) {
	// Host collections enumerate maps; API array order is not persisted track order.
	const byId = (items) => {
		assert.equal(new Set(items.map((item) => item.id)).size, items.length);
		return [...items].sort((a, b) => a.id.localeCompare(b.id));
	};
	assert.deepEqual(byId(after.clips), byId(before.clips));
	assert.deepEqual(byId(after.tracks), byId(before.tracks));
	assert.deepEqual(after.context.project, before.context.project);
	assert.equal(after.context.revision, before.context.revision);
	assert(
		(await readFile(join(projectRoot, "project.json"))).equals(beforeBytes),
		"Persisted project.json bytes changed after Host reopen",
	);
	const attachments = [],
		resources = [
			...source.resources,
			...source.build.inputs,
			source.build.toolchainLock,
		];
	for (const resource of resources) {
		const prefix = resource.kind === "source" ? "programmatic-source-sha256-" : "programmatic-sha256-";
		assert.equal(resource.attachmentKey, `${prefix}${resource.sha256}`, "Unexpected attachment key");
		const bytes = await readFile(
			join(projectRoot, "attachments", resource.attachmentKey, "body.bin"),
		);
		const hash = createHash("sha256").update(bytes).digest("hex");
		assert.equal(bytes.length, resource.byteLength);
		assert.equal(hash, resource.sha256);
		attachments.push({ id: resource.id, sha256: hash, bytes: bytes.length });
	}
	return attachments;
}
