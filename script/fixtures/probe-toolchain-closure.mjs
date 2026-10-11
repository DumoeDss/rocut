import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	parseUtf8Json,
	pinClosure,
	sha256,
} from "./frozen-attempt-identity.mjs";

async function packageDirectory(require, name) {
	let entry;
	try {
		entry = require.resolve(`${name}/package.json`);
	} catch {
		entry = require.resolve(name);
	}
	let directory = dirname(entry);
	for (;;) {
		try {
			const manifest = parseUtf8Json(
				await readFile(join(directory, "package.json")),
			);
			if (manifest.name === name)
				return { directory: await realpath(directory), entry, manifest };
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
		const parent = dirname(directory);
		assert.notEqual(
			parent,
			directory,
			`Resolved package has no named manifest: ${name}`,
		);
		directory = parent;
	}
}

/** Follow actual runtime resolution, not declarations in the workspace lock.
 * No install or copy. An unavailable optional peer is explicit; a missing
 * ordinary dependency rejects the closure before any browser is launched. */
export async function pinProbeToolchain(roots) {
	const packages = new Map(),
		resolutions = [];
	async function visit(manifestPath, name, optional = false) {
		const require = createRequire(manifestPath);
		let found;
		try {
			found = await packageDirectory(require, name);
		} catch (error) {
			if (
				!optional ||
				!["MODULE_NOT_FOUND", "ERR_PACKAGE_PATH_NOT_EXPORTED"].includes(
					error.code,
				)
			)
				throw error;
			resolutions.push({
				importer: manifestPath,
				name,
				available: false,
				optional: true,
			});
			return;
		}
		resolutions.push({
			importer: manifestPath,
			name,
			entry: found.entry,
			directory: found.directory,
			available: true,
			optional,
		});
		if (packages.has(found.directory)) return;
		const record = {
			name,
			version: found.manifest.version,
			closure: await pinClosure(found.directory),
		};
		packages.set(found.directory, record);
		const dependencies = new Map(
			Object.keys(found.manifest.dependencies ?? {}).map((key) => [key, false]),
		);
		for (const key of Object.keys(found.manifest.optionalDependencies ?? {}))
			dependencies.set(key, true);
		for (const key of Object.keys(found.manifest.peerDependencies ?? {})) {
			if (!dependencies.has(key))
				dependencies.set(
					key,
					!!found.manifest.peerDependenciesMeta?.[key]?.optional,
				);
		}
		for (const [dependency, canBeMissing] of [...dependencies.entries()].sort(
			([a], [b]) => a.localeCompare(b),
		))
			await visit(
				join(found.directory, "package.json"),
				dependency,
				canBeMissing,
			);
	}
	for (const { manifestPath, names } of roots)
		for (const name of names) await visit(manifestPath, name);
	const files = [...packages.values()].sort((a, b) =>
		a.closure.directory.localeCompare(b.closure.directory),
	);
	return {
		packageCount: files.length,
		packages: files,
		resolutions,
		manifestSha256: sha256(JSON.stringify({ packages: files, resolutions })),
	};
}
