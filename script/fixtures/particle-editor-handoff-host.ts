import assert from "node:assert/strict";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startHost, type RunningHost } from "../../apps/cli/src/host";
import { TargetRegistry } from "../../apps/cli/src/target-registry";
import {
	hash,
	inside,
	plain,
	readJson,
	treeManifest,
} from "../particle-c4-export-support.mjs";

const [root, projectRoot, staticDir, toolchain, chromium] =
	process.argv.slice(2);
const observed = (globalThis as any).__particleC2Processes as {
	closed: boolean;
}[];
const secrets = new Set<string>();
const write = (name: string, value: unknown) =>
	writeFile(join(root, name), JSON.stringify(value, null, 2) + "\n", {
		flag: "wx",
	});
const redact = (value: unknown) => {
	let text = String(value);
	for (const secret of secrets)
		text = text.replaceAll(secret, "[private-capability]");
	return text.replace(/https?:\/\/[^\s"'<>]+/g, "[URL redacted]");
};
const byId = <T extends { id: string }>(items: readonly T[]) =>
	[...items].sort((a, b) => a.id.localeCompare(b.id));
let host: RunningHost | undefined,
	failure: unknown,
	timer: ReturnType<typeof setTimeout> | undefined;
let validated = false;
const options = {
	projectRoot,
	staticDir,
	engineToolchainDirectory: toolchain,
	htmlBrowserExecutable: chromium,
	htmlFrameConnectionFile: "",
	registry: new TargetRegistry(join(root, "registry")),
};
const snapshot = async () => {
	assert.ok(host);
	return {
		clips: byId(await host.automation.clips()),
		tracks: byId(await host.automation.tracks()),
		revision: await host.automation.revision(),
	};
};
const open = async () => {
	host = await startHost(options);
	secrets.add(host.token);
	secrets.add(host.editorUrl);
	return host;
};
try {
	assert.equal(process.versions.bun, "1.2.18");
	for (const path of [root, projectRoot, staticDir]) {
		assert.ok(inside("C:/tmps/rocut-stylized-f6XU4z", path));
		await plain(path, true);
	}
	assert.ok(Array.isArray(observed));
	validated = true;
	const before = await treeManifest(projectRoot),
		expected = await readJson(join(root, "expected-final-state.json"));
	assert.equal(expected.revision, 7);
	assert.equal(
		expected.clips.find((clip: any) => clip.id === "particle-model").editing
			.params.opacity,
		0.55,
	);
	const current = await open();
	assert.deepEqual(
		await snapshot(),
		expected,
		"Continuation must reopen the exact previously saved UI state",
	);
	await write("initial-reopened-state.json", await snapshot());
	await write("host-ready.pending-private.json", {
		token: current.token,
		editorUrl: current.editorUrl,
	});
	await rename(
		join(root, "host-ready.pending-private.json"),
		join(root, "host-ready.private.json"),
	);
	await new Promise<void>((done) => {
		process.stdin.once("data", () => done());
		process.stdin.once("end", () => done());
		process.once("SIGTERM", () => done());
		timer = setTimeout(() => {
			failure = Error("Handoff Host watchdog expired");
			done();
		}, 900000);
	});
	assert.deepEqual(
		await snapshot(),
		expected,
		"Read-only preview must preserve complete clips/tracks/revision",
	);
	await current.close();
	host = undefined;
	const reopened = await open();
	await write("host-reopened.private.json", {
		token: reopened.token,
		editorUrl: reopened.editorUrl,
	});
	assert.deepEqual(await snapshot(), expected);
	await write("host-reopened-state.json", await snapshot());
	assert.deepEqual(await treeManifest(projectRoot), before);
	await write("host-project-stability.json", {
		unchanged: true,
		projectSha256: hash(await readFile(join(projectRoot, "project.json"))),
	});
} catch (error) {
	failure = error;
} finally {
	clearTimeout(timer);
	try {
		await host?.close();
	} catch (error) {
		failure = new AggregateError(
			[failure, error].filter(Boolean),
			"Handoff Host close failed",
		);
	}
	if (validated) {
		const deadline = Date.now() + 5000;
		while (observed.some((entry) => !entry.closed) && Date.now() < deadline)
			await new Promise((done) => setTimeout(done, 50));
		const allClosed = observed.every((entry) => entry.closed);
		await write("host-children.json", {
			processes: observed,
			allObservedDirectChildrenClosed: allClosed,
			scope: "Observed direct children only",
		});
		if (!allClosed)
			failure = new AggregateError(
				[failure, Error("Handoff direct children remain open")].filter(Boolean),
			);
		if (failure)
			await write("host-failure.json", {
				error: redact(failure),
				stack: redact((failure as Error)?.stack),
			});
	}
}
if (failure) {
	console.error(redact(failure));
	process.exitCode = 1;
}
