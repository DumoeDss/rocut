import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, resolve, win32 } from "node:path";

export const inputSnapshotLimits = Object.freeze({
	files: 10000,
	bytes: 256 * 1024 * 1024,
});
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const text = (bytes) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);
export async function createPrivateEffectInputs(
	parent,
	limits = inputSnapshotLimits,
) {
	assert(isAbsolute(parent));
	const relative = win32.relative("C:/tmps", parent);
	assert(
		!relative.startsWith("..") && !win32.isAbsolute(relative),
		"Snapshots must stay in private C:/tmps artifacts",
	);
	assert(
		Number.isSafeInteger(limits.files) &&
			limits.files > 0 &&
			limits.files <= inputSnapshotLimits.files,
	);
	assert(
		Number.isSafeInteger(limits.bytes) &&
			limits.bytes > 0 &&
			limits.bytes <= inputSnapshotLimits.bytes,
	);
	const root = await mkdtemp(join(parent, "source-snapshot-"));
	const originals = new Map(),
		writes = new Map();
	let totalBytes = 0,
		storedBytes = 0;
	const load = async (originalPath, strictText) => {
		originalPath = resolve(originalPath);
		assert(
			(await stat(originalPath)).size <= limits.bytes,
			"Input exceeds snapshot byte budget",
		);
		const bytes = await readFile(originalPath),
			hash = sha(bytes);
		if (strictText) text(bytes);
		const prior = originals.get(originalPath);
		if (prior)
			assert.equal(
				prior.sha256,
				hash,
				`Repeated loader read changed live input: ${originalPath}`,
			);
		else {
			assert(
				originals.size + 1 <= limits.files,
				"Snapshot file budget exceeded",
			);
			assert(
				totalBytes + bytes.length <= limits.bytes,
				"Snapshot byte budget exceeded",
			);
			originals.set(originalPath, {
				path: originalPath,
				sha256: hash,
				bytes: bytes.length,
			});
			totalBytes += bytes.length;
		}
		return { originalPath, bytes, sha256: hash };
	};
	const retain = async (input, path, extra = {}) => {
		if (!writes.has(path)) {
			assert(
				writes.size + 1 <= limits.files,
				"Stored snapshot file budget exceeded",
			);
			assert(
				storedBytes + input.bytes.length <= limits.bytes,
				"Stored snapshot byte budget exceeded",
			);
			storedBytes += input.bytes.length;
			writes.set(
				path,
				(async () => {
					await mkdir(join(path, ".."), { recursive: true });
					// wx is mandatory: even an unexpected identical preexisting file is not ours.
					await writeFile(path, input.bytes, { flag: "wx" });
					assert.equal(
						sha(await readFile(path)),
						input.sha256,
						`Snapshot readback changed: ${path}`,
					);
				})(),
			);
		}
		await writes.get(path);
		assert.equal(
			sha(await readFile(path)),
			input.sha256,
			`Immutable snapshot changed: ${path}`,
		);
		const file = {
			...extra,
			path,
			originalPath: input.originalPath,
			bytes: input.bytes.length,
			sha256: input.sha256,
		};
		return { bytes: input.bytes, text: () => text(input.bytes), file };
	};
	const capture = async (path, extra = {}) => {
		const input = await load(path, true);
		return retain(
			input,
			join(root, input.sha256, basename(input.originalPath)),
			extra,
		);
	};
	const captureGroup = async (paths) => {
		const inputs = [];
		for (const path of paths) inputs.push(await load(path, true));
		assert.equal(
			new Set(inputs.map((input) => basename(input.originalPath))).size,
			inputs.length,
			"Dynamic helper basename collision",
		);
		const group = sha(
			JSON.stringify(
				inputs.map((input) => [basename(input.originalPath), input.sha256]),
			),
		);
		const results = [];
		for (const input of inputs)
			results.push(
				await retain(input, join(root, group, basename(input.originalPath))),
			);
		return results;
	};
	const pinBinary = async (path) => {
		const input = await load(path, false);
		return {
			path: input.originalPath,
			bytes: input.bytes.length,
			sha256: input.sha256,
		};
	};
	const verify = async (files) => {
		const issues = [];
		for (const file of [...originals.values(), ...files]) {
			try {
				const actual = sha(await readFile(file.path));
				if (actual !== file.sha256)
					issues.push({
						path: file.path,
						expected: file.sha256,
						actual,
						reason: "drift",
					});
			} catch (error) {
				issues.push({
					path: file.path,
					expected: file.sha256,
					actual: null,
					reason: error.code ?? error.name,
				});
			}
		}
		if (issues.length) {
			const error = new Error(
				`Private build input validation failed: ${issues.length} issue(s)`,
			);
			error.receipt = { ok: false, issues };
			throw error;
		}
		return {
			ok: true,
			liveInputsVerifiedDuringBuild: originals.size,
			snapshotFilesVerified: files.length,
		};
	};
	return {
		root,
		capture,
		captureGroup,
		pinBinary,
		verify,
		evidence: () => ({
			root,
			files: originals.size,
			bytes: totalBytes,
			storedFiles: writes.size,
			storedBytes,
			limits,
			scope:
				"Content-addressed exact-buffer snapshots of actual text loader inputs and explicitly enumerated dynamic helpers/config; private WASM directly pinned. Live source stability checked during build only. Not a full repository/node_modules copy or complete non-text/dynamic dependency closure.",
		}),
	};
}
