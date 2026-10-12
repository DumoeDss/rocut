/** Explicit neighboring-checkout protocol acceptance; no Electron/GPU is launched.
 * Run from the Rocut checkout: bun script/fixtures/electron-audio-session-host-contract.ts
 * Ordinary CLI/Host tests never import this development fixture.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
	openElectronAudioSession,
	pinElectronAudioSessionConnection,
} from "../../apps/cli/src/programmatic/electron-audio-session";

const rocutRoot = resolve(import.meta.dir, "../..");
const hostModule = resolve(
	rocutRoot,
	"../../elftia/elftia/packages/desktop/app/main/services/platform/html-frames/audioSessionHttp.ts",
);
const { AudioSessionHttp } = await import(pathToFileURL(hostModule).href);
const deferred = () => {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
};
const browser = {
	product: "Chrome/contract-fixture",
	revision: "fixture-revision",
	jsVersion: "fixture-js",
	protocolVersion: "1.3",
};
const owner = {
	sessions: new Set<string>(),
	closed: new Set<string>(),
	nativeVideo: false,
	revoked: false,
};
const heldEvaluation = deferred();
const finishEvaluation = deferred();
const disposalStarted = deferred();
const finishDisposal = deferred();
let holdDisposal = false;
let disposedTargets = 0;
const factory = async (
	_input: { profile: "source" | "dsp" },
	signal: AbortSignal,
) => ({
	browser,
	async evaluate(expression: string) {
		signal.throwIfAborted();
		if (expression === "large") return "x".repeat(3 * 1024 * 1024);
		if (expression === "source-overflow") return "x".repeat(32 * 1024 * 1024);
		if (expression === "void") return undefined;
		if (expression === "failure")
			throw Error("private-factory-detail-must-be-redacted");
		if (expression === "wait") {
			heldEvaluation.resolve();
			await Promise.race([
				finishEvaluation.promise,
				new Promise<never>((_resolve, reject) => {
					signal.addEventListener(
						"abort",
						() => reject(Error("private target aborted")),
						{ once: true },
					);
				}),
			]);
			signal.throwIfAborted();
		}
		return { observed: true };
	},
	async dispose() {
		disposedTargets++;
		if (holdDisposal) {
			disposalStarted.resolve();
			await finishDisposal.promise;
		}
	},
});
const service: {
	active: Map<string, unknown>;
	epoch: string;
	handle: (
		request: IncomingMessage,
		response: ServerResponse,
		grant: typeof owner,
	) => Promise<void>;
	dispose(): Promise<void>;
} = new AudioSessionHttp(factory, () => service.active.size < 2);
const token = randomBytes(32).toString("hex");
const server = createServer((request, response) => {
	if (request.headers.authorization !== `Bearer ${token}`) {
		response.writeHead(401).end();
		return;
	}
	void service.handle(request, response, owner);
});
const root = await mkdtemp("C:/tmps/rocut-host-audio-contract-");
const connectionFile = resolve(root, "connection.json");
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const address = server.address();
assert(address && typeof address !== "string");
const endpoint = `http://127.0.0.1:${address.port}/v1/frame`;
const signal = AbortSignal.timeout(15000);
const open = (profile: "source" | "dsp", lifetime = signal) =>
	openElectronAudioSession({
		connectionFile,
		profile,
		width: 8,
		height: 8,
		signal: lifetime,
	});
try {
	await writeFile(
		connectionFile,
		JSON.stringify({
			version: 1,
			backend: "elftia-electron",
			endpoint,
			token,
			capabilities: {
				nativeAudioAnalysis: {
					version: 1,
					protocol: "html-frames-native-audio-v1",
				},
				nativeAudioSession: {
					version: 1,
					protocol: "html-frames-native-audio-session-v1",
				},
			},
		}),
		"utf8",
	);
	assert.equal(
		pinElectronAudioSessionConnection(connectionFile).endpoint,
		endpoint.replace("/v1/frame", "/v1/audio-sessions"),
	);
	const source = await open("source");
	const dsp = await open("dsp");
	assert.deepEqual(source.browser, browser);
	assert.deepEqual(dsp.browser, browser);
	assert.match(source.epoch, /^[a-f0-9]{32}$/);
	assert.equal(source.epoch, dsp.epoch);
	assert.equal(source.epoch, service.epoch);
	assert.equal(
		((await source.evaluate("large")) as string).length,
		3 * 1024 * 1024,
	);
	assert.equal(await source.evaluate("void"), null);
	await assert.rejects(dsp.evaluate("large"), /HTTP 413/);
	await dsp.close();
	assert.equal(service.active.size, 1);
	await assert.rejects(source.evaluate("source-overflow"), /HTTP 413/);
	await source.close();
	assert.equal(service.active.size, 0);
	const failed = await open("source");
	await assert.rejects(failed.evaluate("failure"), /HTTP 408/);
	await failed.close();
	assert.equal(service.active.size, 0);

	const cancelled = new AbortController();
	const held = await open("source", cancelled.signal);
	const id = Array.from(owner.sessions)[0];
	const running = held.evaluate("wait", { timeoutMs: 5000 });
	const runningResult = running.then(
		() => null,
		(error) => error as Error,
	);
	await heldEvaluation.promise;
	await assert.rejects(held.evaluate("void"), /busy/);
	const busy = await fetch(
		endpoint.replace("/v1/frame", `/v1/audio-sessions/${id}/evaluate`),
		{
			method: "POST",
			headers: { authorization: `Bearer ${token}` },
			signal,
			body: JSON.stringify({ version: 1, expression: "void", timeoutMs: 1000 }),
		},
	);
	assert.equal(busy.status, 409);
	assert.deepEqual(await busy.json(), {
		error: "Native audio session request failed",
	});
	assert.equal(service.active.size, 1);
	holdDisposal = true;
	cancelled.abort();
	await disposalStarted.promise;
	assert.equal(service.active.size, 1);
	finishDisposal.resolve();
	assert((await runningResult) instanceof Error);
	await held.close();
	assert.equal(service.active.size, 0);
	assert.equal(disposedTargets, 4);
	console.log(
		JSON.stringify({
			passed: true,
			transport: "real-Host-AudioSessionHttp-to-Rocut-client",
			checks: [
				"browser-and-epoch",
				"source-3MiB",
				"source-32MiB-ceiling",
				"dsp-2MiB-ceiling",
				"undefined-null",
				"busy-409",
				"redacted-failure-idempotent-close",
				"cancel-close-drain-slot",
			],
		}),
	);
} finally {
	finishEvaluation.resolve();
	finishDisposal.resolve();
	await service.dispose();
	server.closeAllConnections();
	await new Promise<void>((done) => server.close(() => done()));
	if (dirname(resolve(root)) !== resolve("C:/tmps"))
		throw Error("Unsafe fixture cleanup");
	await rm(root, { recursive: true });
}
