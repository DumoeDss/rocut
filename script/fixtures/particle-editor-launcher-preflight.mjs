import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { hash, inside, plain } from "../particle-c4-export-support.mjs";
import { parseParticleEditorOptions } from "./particle-editor-contract.mjs";
import {
	admitParticleAuthority,
	admitParticleCompileBaseline,
	assertParticleAuthorityRuntime,
	parseParticleAuthoritySelection,
} from "./particle-editor-export-authority.mjs";
import {
	particleAuthorityPaths,
	writeParticleAuthorityContext,
} from "./particle-editor-export-authority-stage.mjs";

export async function prepareParticleEditorLaunch({ args }) {
	const options = parseParticleEditorOptions(args);
	const selection = parseParticleAuthoritySelection(options);
	const paths =
		selection.kind === "new-authority"
			? particleAuthorityPaths(options)
			: undefined;
	const authority = paths
		? await admitParticleAuthority({ selection, paths })
		: undefined;
	const baseline = authority
		? await admitParticleCompileBaseline({
				authority,
				receiptPath: options["compile-baseline-receipt"],
			})
		: undefined;
	if (authority) {
		assertParticleAuthorityRuntime({
			authority,
			name: "node",
			executable: process.execPath,
			version: process.version,
		});
		assert.equal(
			resolve(options["source-project"]).toLowerCase(),
			resolve(baseline.metadata.project.root).toLowerCase(),
		);
		assert.ok(inside("C:/tmps", options["artifacts-root"]));
	} else {
		assert.ok(
			inside("C:/tmps/rocut-stylized-f6XU4z", options["source-project"]),
		);
		assert.equal(
			resolve(options["artifacts-root"]).toLowerCase(),
			resolve("C:/tmps/rocut-stylized-f6XU4z").toLowerCase(),
		);
	}
	for (const key of [
		"artifacts-root",
		"source-project",
		"sampler-dir",
		"toolchain",
	])
		await plain(options[key], true);
	for (const key of ["bun", "wasm-sync", "chromium"])
		await plain(options[key], false);
	const root = await mkdtemp(
		join(options["artifacts-root"], "particle-editor-"),
	);
	await mkdir(join(root, "temp"));
	const authorityContextPath = authority
		? await writeParticleAuthorityContext({
				authority,
				root,
				selection,
				paths,
				baselineReceiptPath: options["compile-baseline-receipt"],
			})
		: undefined;
	const env = {
		...process.env,
		TEMP: join(root, "temp"),
		TMP: join(root, "temp"),
		TMPDIR: join(root, "temp"),
		ELFTIA_HTML_FRAME_CONNECTION_FILE: "",
		ROCUT_HTML_BROWSER_PATH: options.chromium,
	};

	return { options, authority, baseline, root, authorityContextPath, env };
}

/** Record every extracted launcher responsibility before building its inputs. */
export async function rememberParticleLauncherSources({ repo, sources }) {
	for (const name of [
		"preflight",
		"browser-session",
		"handoff",
		"refactor.test",
	]) {
		const path = resolve(
			repo,
			"script/fixtures",
			"particle-editor-launcher-" + name + ".mjs",
		);
		const bytes = await readFile(path);
		const entry = { path, bytes: bytes.length, sha256: hash(bytes) };
		if (sources.has(path))
			assert.deepEqual(
				sources.get(path),
				entry,
				"Launcher input changed during preparation",
			);
		sources.set(path, entry);
	}
}
