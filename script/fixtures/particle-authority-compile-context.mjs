import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
	admitParticleAuthority,
	assertParticleAuthorityRuntime,
} from "./particle-editor-export-authority.mjs";
import { verifyParticleAuthorityStage } from "./particle-editor-export-authority-stage.mjs";
import { plain } from "../particle-c4-export-support.mjs";

export async function writeParticleCompileContext({
	authority,
	root,
	selection,
	paths,
}) {
	await authority.assertOutputRoot(root);
	const path = join(root, "particle-compile-authority-context.json");
	await writeFile(
		path,
		JSON.stringify(
			{
				version: 1,
				stage: "compile-only",
				root,
				selection,
				paths,
				authorityReceiptSha256: authority.authorityReceiptSha256,
			},
			null,
			2,
		) + "\n",
		{ flag: "wx" },
	);
	return path;
}
export async function admitParticleCompileHostContext({
	root,
	path,
	executable,
	version,
}) {
	assert.equal(
		resolve(path),
		resolve(root, "particle-compile-authority-context.json"),
	);
	await plain(path, false);
	const bytes = await readFile(path);
	assert.ok(bytes.length > 0 && bytes.length <= 64 * 1024);
	assert.ok(!(bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191));
	const context = JSON.parse(
		new TextDecoder("utf8", { fatal: true }).decode(bytes),
	);
	assert.deepEqual(
		Object.keys(context).sort(),
		[
			"version",
			"stage",
			"root",
			"selection",
			"paths",
			"authorityReceiptSha256",
		].sort(),
	);
	assert.equal(context.version, 1);
	assert.equal(context.stage, "compile-only");
	assert.equal(resolve(context.root), resolve(root));
	const authority = await admitParticleAuthority({
		selection: context.selection,
		paths: context.paths,
	});
	assert.equal(
		context.authorityReceiptSha256,
		authority.authorityReceiptSha256,
	);
	assertParticleAuthorityRuntime({
		authority,
		name: "bun",
		executable,
		version,
	});
	await verifyParticleAuthorityStage({ authority, root });
	return { authority, context };
}
export async function writeParticleCompileBootstrap({
	authority,
	root,
	remember,
}) {
	await authority.assertOutputRoot(root);
	const observer = new URL(
		"./particle-editor-export-authority-browser.mjs",
		import.meta.url,
	).href;
	const source = `import { join } from "node:path";
import { admitParticleCompileHostContext } from ${JSON.stringify(import.meta.url)};
import { installParticleAuthorityBrowserObserver } from ${JSON.stringify(observer)};
const root = process.argv[2];
await admitParticleCompileHostContext({root,path:join(root,"particle-compile-authority-context.json"),executable:process.execPath,version:process.versions.bun});
installParticleAuthorityBrowserObserver({expectedWasmSha256:${JSON.stringify(authority.metadata.nativeAuthority.wasmSha256)}});
await import("./host-body.mjs");
`;
	await writeFile(join(root, "host.mjs"), source, { flag: "wx" });
	await remember(join(root, "host.mjs"));
}
