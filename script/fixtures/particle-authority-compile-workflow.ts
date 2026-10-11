import assert from "node:assert/strict";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProgrammaticSource } from "../../packages/editor-contracts/src/programmatic";
import type { ProgrammaticResource } from "../../packages/editor-contracts/src/programmatic-resources";
import { threeModel } from "./three-assets";
import {
	PARTICLE_BASELINE_CONTRACT,
	assertParticleBaselineState,
} from "./particle-authority-prepare-contract.mjs";
import { loadThreeParticleRuntime } from "../../apps/cli/src/programmatic/three-particle-provenance";
import type { ParticleCompileSession } from "./particle-authority-compile-session";
import type { ParticleCompileInputs } from "./particle-authority-compile-inputs";

export async function compileParticleBaseline(
	session: ParticleCompileSession,
	inputs: ParticleCompileInputs,
) {
	const {
		admittedAuthority,
		hostWasmObservation,
		authorHash,
		templateHash,
		particleThree,
	} = inputs;
	const {
		signal,
		checks,
		root,
		projectRoot,
		author,
		retainedAuthor,
		toolchainDirectory,
		hash,
		json,
		checkpoint,
		verifyResources,
		allClosed,
		apply,
		currentSource,
		openHost,
		closeHost,
		plain,
		absent,
		childOf,
		revision,
		snapshots,
	} = session;
	const runtime = await loadThreeParticleRuntime(
		signal,
		admittedAuthority.authority.metadata.productionIdentity.packedSidecar,
	);
	assert.deepEqual(
		runtime.samplerIdentity,
		admittedAuthority.authority.metadata.productionIdentity.packedSidecar,
	);
	checks.push({
		label: "actual packed-sidecar worker initialization and awaited close",
		runtime,
		actualWorkerClosedBeforeReceipt: true,
	});
	await openHost();
	const context = await json("context");
	assert.equal(context.programmaticBuilds.configured, true);
	assert.ok(
		context.programmaticBuilds.engines.some(
			(entry) => entry.engine === "three",
		),
	);
	assert.ok(context.programmaticResources.kinds.includes("model"));
	const base = await checkpoint("baseline", 0);
	const model = threeModel();
	await writeFile(join(root, "model.glb"), model, { flag: "wx" });
	const imported = await json("programmatic/resources/import", {
		filePath: join(root, "model.glb"),
		id: "fixture-model.glb",
		kind: "model",
		mimeType: "model/gltf-binary",
	});
	const resource = imported.resource as ProgrammaticResource;
	assert.equal(resource.sha256, hash(model));
	assert.equal(resource.byteLength, model.length);
	assert.equal(resource.kind, "model");
	const makeShot = (scatterDistance: number, size: number) =>
		particleThree({
			sourceDirectory: author,
			model: resource,
			settings: { width: 320, height: 240, durationFrames: 121, seed: 7391 },
			inputProps: {
				rotationSpeed: [0, 0, 0],
				motion: { scatterDistance, size, driftAmplitude: 0 },
			},
		});
	const initialShot = makeShot(1.5, 2.5);
	await writeFile(
		join(root, "compile-spec-1.json"),
		JSON.stringify(initialShot.spec, null, 2) + "\n",
		{ flag: "wx" },
	);
	const initial = await json("programmatic/build/compile", initialShot.spec);
	const first = initial.source as ProgrammaticSource;
	assert.deepEqual(first.build?.capabilities, ["particle-surface-v1"]);
	assert.equal(first.build?.engine, "three");
	assert.deepEqual(
		first.resources?.find((entry) => entry.kind === "model"),
		resource,
	);
	const initialResources = await verifyResources(first);
	const prepared = await checkpoint("compiled-unapplied", 0);
	assert.equal(
		prepared.sha256,
		base.sha256,
		"Resource import/compile must not mutate project content",
	);
	allClosed();
	await writeFile(
		join(root, "initial-source.json"),
		JSON.stringify(first, null, 2) + "\n",
		{ encoding: "utf8", flag: "wx" },
	);
	const firstReceipt = await apply(
		0,
		[
			{
				kind: "create-track",
				track: {
					id: "particle-track",
					name: "Particle C4",
					kind: "graphic",
					hidden: false,
				},
			},
			{
				kind: "create-clip",
				clip: {
					id: "particle-model",
					trackId: "particle-track",
					startTime: 0,
					duration: 484000,
					trimStart: 0,
					trimEnd: 0,
					editing: {
						type: "graphic",
						name: "Private particle fixture",
						definitionId: "programmatic",
						params: { opacity: 0.85 },
						effects: initialShot.effects,
						programmatic: first,
					},
				},
			},
		],
		"particle-c4-create",
	);
	await currentSource(first);
	const created = await checkpoint("created", 1);
	await closeHost();
	await openHost();
	await currentSource(first);
	const firstReopen = await checkpoint("first-reopen", 1);
	assert.equal(
		firstReopen.sha256,
		created.sha256,
		"Reopen must preserve persisted project bytes",
	);
	assert.deepEqual(
		firstReopen.fullProjectManifest,
		created.fullProjectManifest,
		"First reopen must preserve all project and attachment bytes",
	);
	checks.push({
		label:
			"Real resource import, production compile, HTTP apply and FileProjectStore reopen",
		receipt: firstReceipt,
		resources: initialResources,
		projectBytesPreserved: true,
	});

	// A new author spec goes through compile. Never edit archived build props
	// and call rebuild to disguise an authoring change as an identical rebuild.
	const revisedShot = makeShot(0.75, 3.25);
	await writeFile(
		join(root, "compile-spec-2.json"),
		JSON.stringify(revisedShot.spec, null, 2) + "\n",
		{ flag: "wx" },
	);
	const revised = await json("programmatic/build/compile", revisedShot.spec);
	const second = revised.source as ProgrammaticSource;
	assert.notDeepEqual(second, first);
	assert.notEqual(
		second.resources?.find((entry) => entry.kind === "document")?.sha256,
		first.resources?.find((entry) => entry.kind === "document")?.sha256,
	);
	assert.deepEqual(second.build?.inputs, first.build?.inputs);
	assert.deepEqual(second.build?.toolchainLock, first.build?.toolchainLock);
	assert.deepEqual(second.build?.capabilities, ["particle-surface-v1"]);
	assert.deepEqual(
		second.resources?.find((entry) => entry.kind === "model"),
		resource,
	);
	assert.equal(
		(second.build?.inputProps as { motion: { scatterDistance: number } }).motion
			.scatterDistance,
		0.75,
	);
	assert.equal(
		(second.build?.inputProps as { motion: { size: number } }).motion.size,
		3.25,
	);
	const revisedResources = await verifyResources(second);
	const revisedUnapplied = await checkpoint("recompiled-unapplied", 1);
	assert.equal(revisedUnapplied.sha256, firstReopen.sha256);
	const beforeEdit = await currentSource(first);
	const secondReceipt = await apply(
		1,
		[
			{
				kind: "update-clip",
				clipId: "particle-model",
				patch: { editing: { ...beforeEdit.editing, programmatic: second } },
			},
		],
		"particle-c4-replace-source",
	);
	await currentSource(second);
	const changed = await checkpoint("changed", 2);
	await writeFile(
		join(root, "revised-source.json"),
		JSON.stringify(second, null, 2) + "\n",
		{ encoding: "utf8", flag: "wx" },
	);
	await closeHost();
	await openHost();
	await currentSource(second);
	const secondReopen = await checkpoint("second-reopen", 2);
	assert.equal(secondReopen.sha256, changed.sha256);
	assert.deepEqual(
		secondReopen.fullProjectManifest,
		changed.fullProjectManifest,
		"Second reopen must preserve all project and attachment bytes",
	);
	checks.push({
		label:
			"Explicit parameter recompile and full source replacement survive second reopen",
		receipt: secondReceipt,
		resources: revisedResources,
		originalSourceUnmodified: true,
		projectBytesPreserved: true,
	});

	// Exact validated paths only. This private author's directory is restored
	// in finally even if archive rebuild or any integrity assertion fails.
	await plain(author, true);
	await absent(retainedAuthor);
	assert.ok(childOf(root, author) && childOf(root, retainedAuthor));
	await rename(author, retainedAuthor);
	session.authorMoved = true;
	await absent(author);
	for (const [label, source] of [
		["original", first],
		["revised", second],
	] as const) {
		const rebuilt = await json("programmatic/build/rebuild", source);
		assert.deepEqual(rebuilt.source, source);
		assert.equal(rebuilt.reusedDocument, true);
		await verifyResources(rebuilt.source);
		await currentSource(second);
		assert.equal(await revision(), 2);
		allClosed();
		checks.push({
			label: `${label} source rebuilds unchanged from attachments while author directory is absent`,
			reusedDocument: true,
		});
	}
	const afterRebuild = await checkpoint("archive-rebuilt", 2);
	assert.equal(afterRebuild.sha256, secondReopen.sha256);
	const state = {
		clips: [...(await session.host!.automation.clips())].sort((a, b) =>
			a.id.localeCompare(b.id),
		),
		tracks: [...(await session.host!.automation.tracks())].sort((a, b) =>
			a.id.localeCompare(b.id),
		),
		revision: await revision(),
	};
	const wrapper = JSON.parse(
		new TextDecoder("utf8", { fatal: true }).decode(
			await readFile(join(projectRoot, "project.json")),
		),
	);
	assertParticleBaselineState({
		state,
		source: second,
		record: wrapper.record,
	});
	await writeFile(
		join(root, "initial-state.json"),
		JSON.stringify(state, null, 2) + "\n",
		{ flag: "wx" },
	);
	return {
		schema: "particle-compile-producer/v1",
		version: 1,
		laneId: admittedAuthority.authority.laneId,
		authorityReceiptSha256: admittedAuthority.authority.authorityReceiptSha256,
		hostWasmObservation,
		fullSourceSha256: hash(JSON.stringify(second)),
		baselineFullStateSha256: hash(
			await readFile(join(root, "initial-state.json")),
		),
		contract: PARTICLE_BASELINE_CONTRACT,
		compileCount: 2,
		applyCount: 2,
		reopenCount: 2,
		selfApproved: false,
		browserLaunched: false,
		scope:
			"Private real Host/FileProjectStore/API persistence and archive rebuild; no UI, Electron capture or video export",
		root,
		runtime: { bun: process.versions.bun, executable: process.execPath },
		checks,
		snapshots,
		model: {
			origin: "locally generated threeModel GLB; no user resource",
			resource,
		},
		templateSha256: templateHash,
		authorSha256: authorHash,
		toolchainPackageLockSha256: hash(
			await readFile(join(toolchainDirectory, "package-lock.json")),
		),
		inputPolicy: {
			freshPrivateProjectRequired: true,
			sharedRegistryUsed: false,
			installedDependenciesChanged: false,
			sharedApplicationRestarted: false,
			userDataTouched: false,
			artifactDeletionPerformed: false,
		},
	};
}
