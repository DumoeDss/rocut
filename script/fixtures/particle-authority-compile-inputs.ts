import assert from "node:assert/strict";
import { lstat, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { admitParticleCompileHostContext } from "./particle-authority-compile-context.mjs";
import type { ParticleCompileSession } from "./particle-authority-compile-session";

export async function admitParticleCompileInputs(
	session: ParticleCompileSession,
) {
	const {
		rootArgument,
		toolchainDirectory,
		authorityContextPath,
		root,
		parent,
		author,
		projectRoot,
		retainedAuthor,
		childOf,
		samePath,
		plain,
		absent,
		hash,
	} = session;
	const admittedAuthority = (session.admittedAuthority =
		await admitParticleCompileHostContext({
			root,
			path: authorityContextPath,
			executable: process.execPath,
			version: process.versions.bun,
		}));
	assert.ok(childOf(resolve("C:/tmps"), root));
	const observer = Reflect.get(
		globalThis,
		"__particleAuthorityWasmObservation",
	);
	assert.ok(
		observer,
		"Compiler authority bootstrap must precede static sync imports",
	);
	const hostWasmObservation = await observer.assertConsumed();
	assert.ok(rootArgument && isAbsolute(rootArgument));
	assert.ok(samePath(dirname(root), parent));
	assert.ok(basename(root).startsWith("particle-authority-compile-"));
	assert.ok(samePath(await realpath(root), root));
	const rootStat = await lstat(root);
	assert.equal(rootStat.isSymbolicLink(), false);
	assert.equal(rootStat.isDirectory(), true);
	session.rootValidated = true;
	assert.ok(
		childOf(parent, resolve(tmpdir())) || samePath(parent, tmpdir()),
		"Compiler scratch must stay under the approved temporary parent",
	);
	assert.ok(toolchainDirectory && isAbsolute(toolchainDirectory));
	await plain(author, true);
	await plain(join(author, "particle-scene.ts"), false);
	await plain(join(root, "particle-object.mjs"), false);
	for (const path of [
		projectRoot,
		join(root, "registry"),
		retainedAuthor,
		join(root, "model.glb"),
	])
		await absent(path);
	const authorHash = hash(await readFile(join(author, "particle-scene.ts")));
	const templateHash = hash(await readFile(join(root, "particle-object.mjs")));
	const { particleThree } = await import(
		pathToFileURL(join(root, "particle-object.mjs")).href
	);
	return {
		admittedAuthority,
		hostWasmObservation,
		authorHash,
		templateHash,
		particleThree,
	};
}
export type ParticleCompileInputs = Awaited<
	ReturnType<typeof admitParticleCompileInputs>
>;
