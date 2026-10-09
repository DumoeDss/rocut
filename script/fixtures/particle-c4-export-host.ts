import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { startHost, type RunningHost } from "../../apps/cli/src/host";
import { TargetRegistry } from "../../apps/cli/src/target-registry";

const [
	rootArgument,
	toolchain,
	chromium,
	ffmpeg,
	ffprobe,
	clipId,
	electronConnectionFile,
] = process.argv.slice(2);
const root = resolve(rootArgument || ".");
const secrets = new Set<string>();
const observed = (globalThis as any).__particleC2Processes as {
	closed: boolean;
}[];
const digest = (bytes: Uint8Array) =>
	createHash("sha256").update(bytes).digest("hex");
const redact = (value: unknown) => {
	let text = String(value);
	for (const secret of secrets)
		text = text.replaceAll(secret, "[private-host-capability]");
	return text;
};
const write = (name: string, value: unknown) =>
	writeFile(join(root, name), JSON.stringify(value, null, 2) + "\n", {
		flag: "wx",
	});
let host: RunningHost | undefined;
let validated = false;
let failure: unknown;
let failed = false;
let watchdog: ReturnType<typeof setTimeout> | undefined;

try {
	assert.equal(process.versions.bun, "1.2.18");
	assert.ok(rootArgument && isAbsolute(rootArgument));
	const tail = relative(resolve("C:/tmps"), root);
	assert.ok(
		tail && tail !== ".." && !tail.startsWith(`..${sep}`) && !isAbsolute(tail),
	);
	assert.equal((await realpath(root)).toLowerCase(), root.toLowerCase());
	assert.equal((await lstat(root)).isSymbolicLink(), false);
	for (const value of [toolchain, chromium, ffmpeg, ffprobe])
		assert.ok(value && isAbsolute(value));
	assert.ok(clipId);
	if (electronConnectionFile) {
		assert.ok(isAbsolute(electronConnectionFile));
		const relativeConnection = relative(
			resolve("C:/tmps"),
			electronConnectionFile,
		);
		assert.ok(
			relativeConnection &&
				relativeConnection !== ".." &&
				!relativeConnection.startsWith(`..${sep}`) &&
				!isAbsolute(relativeConnection),
		);
		assert.equal((await lstat(electronConnectionFile)).isSymbolicLink(), false);
		assert.equal(
			(await realpath(electronConnectionFile)).toLowerCase(),
			electronConnectionFile.toLowerCase(),
		);
		const connectionBytes = await readFile(electronConnectionFile);
		assert.ok(connectionBytes.length <= 4096);
		const connection = JSON.parse(
			new TextDecoder("utf-8", { fatal: true }).decode(connectionBytes),
		);
		assert.match(connection.token, /^[a-f0-9]{64}$/);
		secrets.add(connection.token);
	}
	assert.ok(Array.isArray(observed), "Private direct-child observer required");
	validated = true;
	const projectBefore = await readFile(join(root, "project", "project.json"));
	host = await startHost({
		projectRoot: join(root, "project"),
		staticDir: join(root, "editor"),
		registry: new TargetRegistry(join(root, "registry")),
		engineToolchainDirectory: toolchain,
		htmlBrowserExecutable: electronConnectionFile ? undefined : chromium,
		htmlFrameConnectionFile: electronConnectionFile ?? "",
		nativeVideoDecoder: { ffmpeg, ffprobe },
	});
	secrets.add(host.token);
	secrets.add(host.editorUrl);
	const clips = await host.automation.clips();
	const clip = clips.find((entry) => entry.id === clipId);
	assert.ok(
		clip?.editing?.programmatic,
		"Requested persisted clip must have a programmatic source",
	);
	const source = clip.editing.programmatic;
	assert.ok(source.build);
	assert.equal(source.build?.engine, "three");
	assert.ok(source.build.capabilities?.includes("particle-surface-v1"));
	assert.deepEqual(source.frameRate, { numerator: 30, denominator: 1 });
	assert.ok(source.durationFrames >= 6);
	const verified = [];
	for (const resource of [
		...(source.resources ?? []),
		...source.build.inputs,
		source.build.toolchainLock,
	]) {
		const response: Response = await fetch(
			new URL("api/programmatic/resources/load", host.editorUrl),
			{
				method: "POST",
				body: JSON.stringify(resource),
				signal: AbortSignal.timeout(15000),
			},
		);
		assert.equal(
			response.ok,
			true,
			"Persisted resource must be readable through real Host API",
		);
		const bytes = new Uint8Array(await response.arrayBuffer());
		assert.equal(bytes.length, resource.byteLength);
		assert.equal(digest(bytes), resource.sha256);
		verified.push({
			id: resource.id,
			sha256: resource.sha256,
			bytes: bytes.length,
		});
	}
	await write("persisted-source.json", source);
	await write("persisted-clip.json", clip);
	await write("host-input-evidence.json", {
		sourceBackend: electronConnectionFile
			? "elftia-electron-particle-session-v2"
			: "private-chromium",
		source: "actual reopened FileProjectStore automation.clips()",
		clipId,
		projectSha256: digest(projectBefore),
		verifiedResources: verified,
		scope:
			"Exports this actual persisted source, not the complete project timeline/clip opacity semantics",
	});
	await write("host-ready.pending-private.json", {
		editorUrl: host.editorUrl,
		token: host.token,
	});
	await rename(
		join(root, "host-ready.pending-private.json"),
		join(root, "host-ready.private.json"),
	);
	await new Promise<void>((done) => {
		process.stdin.once("data", () => done());
		process.stdin.once("end", () => done());
		process.once("SIGTERM", () => done());
		watchdog = setTimeout(() => {
			failed = true;
			failure = Error("Private export Host watchdog elapsed");
			done();
		}, 360000);
	});
	assert.equal(
		digest(await readFile(join(root, "project", "project.json"))),
		digest(projectBefore),
		"Read-only export must not change persisted project bytes",
	);
} catch (error) {
	failed = true;
	failure = error;
} finally {
	clearTimeout(watchdog);
	try {
		await host?.close();
	} catch (error) {
		failure = failed
			? new AggregateError([failure, error], "Export Host and close failed")
			: error;
		failed = true;
	}
	if (validated) {
		const allClosed = observed.every((entry) => entry.closed);
		await write("host-children.json", {
			processes: observed,
			allObservedDirectChildrenClosed: allClosed,
			scope: "Only observed direct processes, not arbitrary descendants",
		});
		if (!allClosed) {
			failed = true;
			failure = Error("Some observed direct Host children are not closed");
		}
		if (failed)
			await write("host-failure.json", {
				error: redact(failure),
				stack: redact((failure as Error)?.stack),
			});
	}
}
if (failed) {
	console.error(redact(failure));
	process.exitCode = 1;
}
