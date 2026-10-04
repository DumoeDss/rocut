import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	writeFile,
} from "node:fs/promises";
import { basename, join } from "node:path";

export const checksum = (bytes) =>
	createHash("sha256").update(bytes).digest("hex");

async function copyRegularTree(from, to) {
	await mkdir(to, { recursive: true });
	for (const entry of await readdir(from, { withFileTypes: true })) {
		assert(
			!entry.isSymbolicLink(),
			"Fixture attachments must not follow links",
		);
		if (entry.isDirectory())
			await copyRegularTree(join(from, entry.name), join(to, entry.name));
		else {
			assert(entry.isFile());
			await copyFile(
				join(from, entry.name),
				join(to, entry.name),
				constants.COPYFILE_EXCL,
			);
		}
	}
}

export async function createLegacyProjectFixture({
	source,
	ownerFolder,
	work,
	version,
	invalidIdentity = false,
	payloadVersion = version,
}) {
	const folder = await mkdtemp(join(ownerFolder, "rocut", "migration-"));
	const wrapper = JSON.parse(
		await readFile(join(source, "project.json"), "utf8"),
	);
	assert.equal(wrapper.record.schemaVersion, 32);
	const id = basename(folder);
	wrapper.record.id = wrapper.summary.id = wrapper.record.data.metadata.id = id;
	wrapper.record.schemaVersion = version;
	wrapper.record.data.version = payloadVersion;
	wrapper.record.data.scenes.forEach((scene) => {
		scene.tracks.overlay = [];
	});
	if (version < 32) delete wrapper.record.data.motionTextSequences;
	else wrapper.record.data.motionTextSequences = [];
	wrapper.record.data.providerExtension = {
		preserved: true,
		sourceSchema: version,
	};
	if (invalidIdentity) delete wrapper.record.data.metadata.id;
	const bytes = JSON.stringify(wrapper);
	await writeFile(join(folder, "project.json"), bytes, {
		encoding: "utf8",
		flag: "wx",
	});
	await writeFile(join(work, id + "-before.json"), bytes, {
		encoding: "utf8",
		flag: "wx",
	});
	await copyRegularTree(
		join(source, "attachments"),
		join(folder, "attachments"),
	);
	return { folder, wrapper, checksum: checksum(bytes) };
}
