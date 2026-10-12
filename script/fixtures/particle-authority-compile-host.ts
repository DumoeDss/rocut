import assert from "node:assert/strict";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	PARTICLE_BASELINE_CONTRACT,
	particleClosureFiles,
} from "./particle-authority-prepare-contract.mjs";
import { treeManifest } from "../particle-c4-export-support.mjs";
import { createParticleCompileSession } from "./particle-authority-compile-session";
import { admitParticleCompileInputs } from "./particle-authority-compile-inputs";
import { compileParticleBaseline } from "./particle-authority-compile-workflow";

// The launcher owns pinned Bun/WASM/sampler/toolchain setup. Chromium/ffmpeg
// argv slots are accepted for its shared interface but never used here.
const [rootArgument, toolchainDirectory, authorityContextPath] =
	process.argv.slice(2);
const session = createParticleCompileSession({
	rootArgument,
	toolchainDirectory,
	authorityContextPath,
});
const {
	root,
	projectRoot,
	author,
	retainedAuthor,
	hash,
	plain,
	absent,
	closeHost,
	allClosed,
	checks,
	snapshots,
	processes,
} = session;

async function run() {
	const inputs = await admitParticleCompileInputs(session);
	const { authorHash, templateHash } = inputs;
	let result!: Awaited<ReturnType<typeof compileParticleBaseline>>;
	let failure: unknown;
	try {
		result = await compileParticleBaseline(session, inputs);
	} catch (error) {
		failure = error;
	} finally {
		const errors: unknown[] = [];
		if (session.authorMoved) {
			try {
				await plain(retainedAuthor, true);
				await absent(author);
				await rename(retainedAuthor, author);
				session.authorMoved = false;
			} catch (error) {
				errors.push(error);
			}
		}
		try {
			await closeHost();
		} catch (error) {
			errors.push(error);
		}
		if (errors.length)
			failure = new AggregateError(
				failure ? [failure, ...errors] : errors,
				"C4 fixture and ownership cleanup failed",
			);
	}
	if (failure) throw failure;
	assert.equal(session.authorMoved, false);
	assert.equal(session.host, undefined);
	assert.equal(session.opened, 3);
	assert.equal(session.closed, session.opened);
	assert.equal(
		hash(await readFile(join(author, "particle-scene.ts"))),
		authorHash,
	);
	assert.equal(
		hash(await readFile(join(root, "particle-object.mjs"))),
		templateHash,
	);
	allClosed();
	await session.admittedAuthority.authority.assertUnchanged();
	const finalWasmObservation = await Reflect.get(
		globalThis,
		"__particleAuthorityWasmObservation",
	).assertConsumed();
	return {
		finalWasmObservation,
		...result,
		ownership: {
			hostsOpened: session.opened,
			hostsClosed: session.closed,
			authorRestored: true,
			children: processes,
		},
	};
}

try {
	const evidence = await run();
	await writeFile(
		join(root, "evidence.json"),
		JSON.stringify(evidence, null, 2) + "\n",
		{ encoding: "utf8", flag: "wx" },
	);
	const producerPath = join(root, "evidence.json");
	const actual = evidence;
	const files = particleClosureFiles(await treeManifest(projectRoot));
	const baseline = {
		schema: "particle-compile-baseline/v1",
		laneId: session.admittedAuthority.authority.laneId,
		authorityReceiptSha256:
			session.admittedAuthority.authority.authorityReceiptSha256,
		project: {
			root: projectRoot,
			files,
			closureSha256: hash(JSON.stringify(files)),
		},
		sourceSha256: actual.fullSourceSha256,
		fullStateSha256: actual.baselineFullStateSha256,
		revision: 2,
		contract: PARTICLE_BASELINE_CONTRACT,
		packedSamplerIdentity:
			session.admittedAuthority.authority.metadata.productionIdentity
				.packedSidecar,
		adapterSha256:
			session.admittedAuthority.authority.metadata.productionIdentity
				.adapterSha256,
		producerReceipt: {
			path: producerPath,
			sha256: hash(await readFile(producerPath)),
		},
	};
	await writeFile(
		join(root, "host-baseline-draft.json"),
		JSON.stringify(baseline, null, 2) + "\n",
		{ flag: "wx" },
	);
	console.log(
		JSON.stringify({
			status: "compiled-unapproved",
			baselineReceipt: join(root, "host-baseline-draft.json"),
			selfApproved: false,
			checks: checks.length,
			hostsOpened: session.opened,
			hostsClosed: session.closed,
			children: processes.length,
			evidence: join(root, "evidence.json"),
		}),
	);
} catch (error) {
	// A bad argument must not authorize writes outside the dedicated C4 root.
	if (session.rootValidated) {
		await writeFile(
			join(root, "failure.json"),
			JSON.stringify(
				{
					error: session.redacted(error),
					stack: session.redacted((error as Error)?.stack),
					checks,
					snapshots,
					opened: session.opened,
					closed: session.closed,
					authorMoved: session.authorMoved,
					processes,
				},
				null,
				2,
			),
			{ encoding: "utf8", flag: "wx" },
		);
	}
	throw new Error(session.redacted(error));
}
