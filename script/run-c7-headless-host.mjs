import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, createConnection } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
	checkHeadlessGraphEnvelope,
	HeadlessGraphCheckError,
} from "./check-headless-graph.mjs";
import {
	validateHeadlessRuntimeSensitivityResult,
	validateHeadlessSemanticResult,
} from "./check-headless-semantic-result.mjs";

const SCRIPT = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = resolve(dirname(SCRIPT), "..");
const VITE_ROOT = resolve(REPOSITORY_ROOT, "apps/vite-example");
const NEXT_ROOT = resolve(REPOSITORY_ROOT, "apps/web");
const LOOPBACK = "127.0.0.1";

function parseArguments(values) {
	const parsed = {};
	for (let index = 0; index < values.length; index += 2) {
		parsed[values[index]?.replace(/^--/, "")] = values[index + 1];
	}
	return parsed;
}

function required(args, name) {
	const value = args[name];
	if (!value) throw new Error(`missing --${name}`);
	return value;
}

function slash(value) {
	return String(value).replaceAll("\\", "/");
}

function assertInside(parent, child, label) {
	const relation = slash(relative(parent, child));
	if (relation === ".." || relation.startsWith("../")) {
		throw new Error(`${label} escapes its required root: ${child}`);
	}
}

function normalizedBase(value) {
	if (!value || value === "/") return "";
	return `/${value.replace(/^\/+|\/+$/g, "")}`;
}

function sha256(value) {
	return createHash("sha256").update(value).digest("hex");
}

function delay(milliseconds) {
	return new Promise((resolvePromise) =>
		setTimeout(resolvePromise, milliseconds),
	);
}

async function allocatePort() {
	return await new Promise((resolvePromise, reject) => {
		const server = createServer();
		server.once("error", reject);
		server.listen(0, LOOPBACK, () => {
			const address = server.address();
			if (!address || typeof address === "string") {
				server.close();
				reject(new Error("failed to allocate an owned loopback port"));
				return;
			}
			server.close((error) => {
				if (error) reject(error);
				else resolvePromise(address.port);
			});
		});
	});
}

async function probePort(port) {
	return await new Promise((resolvePromise) => {
		const socket = createConnection({ host: LOOPBACK, port });
		const finish = (reachable) => {
			socket.removeAllListeners();
			socket.destroy();
			resolvePromise(reachable);
		};
		socket.once("connect", () => finish(true));
		socket.once("error", () => finish(false));
		socket.setTimeout(500, () => finish(false));
	});
}

async function waitForPort(port, child, timeoutMilliseconds = 60_000) {
	const deadline = Date.now() + timeoutMilliseconds;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) {
			throw new Error(`owned server exited before port ${port} became ready`);
		}
		if (await probePort(port)) return;
		await delay(200);
	}
	throw new Error(`owned server port ${port} did not become ready`);
}

async function waitForJson(url, child, timeoutMilliseconds = 60_000) {
	const deadline = Date.now() + timeoutMilliseconds;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) {
			throw new Error(`owned browser exited before CDP became ready at ${url}`);
		}
		try {
			const response = await fetch(url);
			if (response.ok) return await response.json();
		} catch {
			// The owned browser has not opened its CDP endpoint yet.
		}
		await delay(200);
	}
	throw new Error(`owned browser CDP endpoint did not become ready: ${url}`);
}

async function waitForExit(child, timeoutMilliseconds) {
	if (!child || child.exitCode !== null) return true;
	return await new Promise((resolvePromise) => {
		const timeout = setTimeout(() => {
			child.removeListener("exit", onExit);
			resolvePromise(false);
		}, timeoutMilliseconds);
		const onExit = () => {
			clearTimeout(timeout);
			resolvePromise(true);
		};
		child.once("exit", onExit);
	});
}

async function terminateOwnedProcess(child) {
	if (!child) return { pid: null, stopped: true, forced: false };
	const pid = child.pid ?? null;
	if (child.exitCode !== null) {
		return { pid, stopped: true, forced: false, exitCode: child.exitCode };
	}
	child.kill();
	if (await waitForExit(child, 5_000)) {
		return { pid, stopped: true, forced: false, exitCode: child.exitCode };
	}
	child.kill("SIGKILL");
	const stopped = await waitForExit(child, 5_000);
	return { pid, stopped, forced: true, exitCode: child.exitCode };
}

async function confirmPortReleased(port) {
	const server = createServer();
	return await new Promise((resolvePromise) => {
		server.once("error", () => resolvePromise(false));
		server.listen(port, LOOPBACK, () => {
			server.close((error) => resolvePromise(!error));
		});
	});
}

function unquote(value) {
	const trimmed = value.trim();
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

async function exampleEnvironment() {
	const source = await readFile(resolve(NEXT_ROOT, ".env.example"), "utf8");
	const values = {};
	for (const line of source.split(/\r?\n/)) {
		const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
		if (match && match[1] !== "NODE_ENV") values[match[1]] = unquote(match[2]);
	}
	return values;
}

function redact(value, secrets) {
	let redacted = String(value);
	for (const secret of secrets) {
		if (secret.length >= 4)
			redacted = redacted.split(secret).join("[redacted]");
	}
	return redacted;
}

function captureProcess(args) {
	const output = { stdout: "", stderr: "" };
	const child = spawn(process.execPath, args.command, {
		cwd: args.cwd,
		env: args.env,
		stdio: ["ignore", "pipe", "pipe"],
		windowsHide: true,
	});
	for (const streamName of ["stdout", "stderr"]) {
		child[streamName]?.on("data", (chunk) => {
			const next = redact(chunk, args.secrets);
			output[streamName] = `${output[streamName]}${next}`.slice(-32_768);
		});
	}
	return { child, output };
}

function graphExpectation(args, outputRoot) {
	return {
		host: args.host,
		producer: args.host === "vite" ? "vite-rollup" : "next-webpack",
		entry: args.entry,
		marker: args.marker,
		acceptedHead: args.head,
		acceptedTree: args.tree,
		repositoryRoot: REPOSITORY_ROOT,
		outputRoot,
	};
}

async function inspectGraph(args, outputRoot) {
	const graphPath = resolve(outputRoot, "c7-headless-graph.json");
	const bytes = await readFile(graphPath);
	const envelope = JSON.parse(bytes.toString("utf8"));
	let checked;
	let negativeControl;
	try {
		checked = checkHeadlessGraphEnvelope(
			envelope,
			graphExpectation(args, outputRoot),
		);
	} catch (error) {
		const issues =
			error instanceof HeadlessGraphCheckError &&
			Array.isArray(error.report?.issues)
				? error.report.issues
				: [];
		if (
			args.proofControl !== "react" ||
			issues.length === 0 ||
			!issues.every((issue) => issue?.rule === "forbidden.react-family")
		) {
			throw error;
		}
		negativeControl = {
			status: "expected-rejection",
			rule: "forbidden.react-family",
			issueCount: issues.length,
		};
	}
	if (args.proofControl === "react" && !negativeControl) {
		throw new Error(
			"React graph sensitivity control was accepted instead of forbidden",
		);
	}
	return {
		path: slash(relative(REPOSITORY_ROOT, graphPath)),
		sha256: sha256(bytes),
		buildId: envelope.build.id,
		moduleCount: checked?.moduleCount ?? envelope.modules?.items?.length,
		moduleSetSha256:
			checked?.moduleSetSha256 ?? envelope.modules?.moduleSetSha256,
		fileSetSha256: checked?.fileSetSha256 ?? envelope.output?.fileSetSha256,
		negativeControl,
	};
}

function validatePayload(payload, args) {
	const expectedControl =
		args.proofControl === "react"
			? new RegExp(
					`^react:[^:]+:${args.host === "vite" ? "browser-mounted" : "server-no-dom"}$`,
				)
			: /^neutral$/;
	if (!payload || !expectedControl.test(payload.proofControl)) {
		throw new Error(
			`${args.proofControl} runtime did not execute its expected proof control`,
		);
	}
	const validate =
		args.proofControl === "react"
			? validateHeadlessRuntimeSensitivityResult
			: validateHeadlessSemanticResult;
	validate(payload.result, {
		host: args.host,
		buildMarker: args.marker,
		acceptedHead: args.head,
		acceptedTree: args.tree,
		entry: args.entry,
	});
	return { result: payload.result, proofControl: payload.proofControl };
}

async function runVite(args, state) {
	const outputRoot = resolve(REPOSITORY_ROOT, args.output);
	assertInside(VITE_ROOT, outputRoot, "Vite output");
	state.graph = await inspectGraph(args, outputRoot);
	state.serverPort = await allocatePort();
	state.browserPort = await allocatePort();
	state.browserProfile = await mkdtemp(
		resolve(tmpdir(), "opencut-c7-browser-"),
	);
	const secrets = [];
	const server = captureProcess({
		command: [
			resolve(REPOSITORY_ROOT, "node_modules/vite/bin/vite.js"),
			"preview",
			"--config",
			resolve(VITE_ROOT, "vite.headless.config.ts"),
			"--host",
			LOOPBACK,
			"--port",
			String(state.serverPort),
			"--strictPort",
		],
		cwd: VITE_ROOT,
		env: {
			...process.env,
			C7_VITE_HEADLESS_OUT_DIR: relative(VITE_ROOT, outputRoot),
			OPENCUT_C7_PUBLIC_BASE: args.base,
			OPENCUT_C7_BUILD_MARKER: args.marker,
			OPENCUT_C7_ACCEPTED_HEAD: args.head,
			OPENCUT_C7_ACCEPTED_TREE: args.tree,
			OPENCUT_C7_REACT_CONTROL: args.proofControl === "react" ? "1" : "0",
		},
		secrets,
	});
	state.server = server.child;
	state.serverLog = server.output;
	await waitForPort(state.serverPort, state.server);

	const browser = spawn(
		chromium.executablePath(),
		[
			"--headless=new",
			`--remote-debugging-address=${LOOPBACK}`,
			`--remote-debugging-port=${state.browserPort}`,
			`--user-data-dir=${state.browserProfile}`,
			"--disable-background-networking",
			"--disable-component-update",
			"--disable-default-apps",
			"--disable-extensions",
			"--disable-sync",
			"--no-first-run",
			"--no-default-browser-check",
			"--enable-unsafe-webgpu",
			"--use-angle=swiftshader",
			"about:blank",
		],
		{ stdio: "ignore", windowsHide: true },
	);
	state.browserProcess = browser;
	const version = await waitForJson(
		`http://${LOOPBACK}:${state.browserPort}/json/version`,
		browser,
	);
	state.browserConnection = await chromium.connectOverCDP(
		version.webSocketDebuggerUrl,
	);
	const contexts = state.browserConnection.contexts();
	const context = contexts[0] ?? (await state.browserConnection.newContext());
	const page = await context.newPage();
	const observations = {
		consoleErrors: [],
		pageErrors: [],
		requestFailures: [],
		httpErrors: [],
	};
	page.on("console", (message) => {
		if (message.type() === "error")
			observations.consoleErrors.push(message.text());
	});
	page.on("pageerror", (error) => observations.pageErrors.push(error.message));
	page.on("requestfailed", (request) =>
		observations.requestFailures.push(
			`${request.method()} ${request.url()} ${request.failure()?.errorText ?? "unknown"}`,
		),
	);
	page.on("response", (response) => {
		if (response.status() >= 400) {
			observations.httpErrors.push(`${response.status()} ${response.url()}`);
		}
	});
	state.observations = observations;
	const url = `http://${LOOPBACK}:${state.serverPort}${normalizedBase(args.base)}/headless.html`;
	await page.goto(url, { waitUntil: "commit" });
	try {
		await page.waitForFunction(
			() => document.documentElement.dataset.c7Headless === "complete",
		);
	} catch (error) {
		const pageState = await page.evaluate(() => ({
			complete: document.documentElement.dataset.c7Headless ?? null,
			stage: document.documentElement.dataset.c7HeadlessStage ?? null,
			reactStage: document.documentElement.dataset.c7ReactControlStage ?? null,
			resultPublished: globalThis.__OPENCUT_C7_HEADLESS_RESULT__ !== undefined,
			bodyText: document.body.textContent?.slice(0, 2_000) ?? "",
		}));
		throw new Error(
			`Vite browser control did not complete: ${error instanceof Error ? error.message : String(error)}; observations=${JSON.stringify(observations)}; page=${JSON.stringify(pageState)}`,
		);
	}
	const payload = await page.evaluate(
		() => globalThis.__OPENCUT_C7_HEADLESS_RESULT__,
	);
	if (Object.values(observations).some((items) => items.length > 0)) {
		throw new Error(
			`Vite browser observations contain errors: ${JSON.stringify(observations)}`,
		);
	}
	const validated = validatePayload(payload, args);
	state.semantic = validated.result;
	state.proofControl = validated.proofControl;
}

async function runNext(args, state) {
	const outputRoot = resolve(REPOSITORY_ROOT, args.output);
	assertInside(NEXT_ROOT, outputRoot, "Next output");
	if (dirname(outputRoot) !== NEXT_ROOT) {
		throw new Error(
			"Next output must be one direct dist directory under apps/web",
		);
	}
	state.graph = await inspectGraph(args, outputRoot);
	state.serverPort = await allocatePort();
	const documentedEnvironment = await exampleEnvironment();
	const secrets = Object.values(documentedEnvironment);
	const server = captureProcess({
		command: [
			resolve(NEXT_ROOT, "node_modules/next/dist/bin/next"),
			"start",
			"-H",
			LOOPBACK,
			"-p",
			String(state.serverPort),
		],
		cwd: NEXT_ROOT,
		env: {
			...process.env,
			...documentedEnvironment,
			NODE_ENV: "production",
			OPENCUT_NEXT_DIST_DIR: basename(outputRoot),
			OPENCUT_PUBLIC_BASE: args.base,
			C4_BUILD_MARKER: args.marker,
			C6_BUILD_MARKER: args.marker,
			OPENCUT_C7_BUILD_MARKER: args.marker,
			OPENCUT_C7_ACCEPTED_HEAD: args.head,
			OPENCUT_C7_ACCEPTED_TREE: args.tree,
			OPENCUT_C7_HEADLESS_PROOF: "1",
			OPENCUT_C7_REACT_CONTROL: args.proofControl === "react" ? "1" : "0",
		},
		secrets,
	});
	state.server = server.child;
	state.serverLog = server.output;
	await waitForPort(state.serverPort, state.server);
	const url = `http://${LOOPBACK}:${state.serverPort}${normalizedBase(args.base)}/c7-headless`;
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(
			`Next headless request failed: ${response.status} ${response.statusText}`,
		);
	}
	const payload = await response.json();
	state.observations = {
		httpStatus: response.status,
		contentType: response.headers.get("content-type"),
	};
	const validated = validatePayload(payload, args);
	state.semantic = validated.result;
	state.proofControl = validated.proofControl;
}

async function main() {
	const parsed = parseArguments(process.argv.slice(2));
	const args = {
		host: required(parsed, "host"),
		output: required(parsed, "output"),
		base: normalizedBase(required(parsed, "base")),
		marker: required(parsed, "marker"),
		head: required(parsed, "head"),
		tree: required(parsed, "tree"),
		entry: required(parsed, "entry"),
		proofControl: parsed["proof-control"] ?? "neutral",
		report: parsed.report ? resolve(parsed.report) : undefined,
	};
	if (args.host !== "vite" && args.host !== "next") {
		throw new Error("--host must be vite or next");
	}
	if (!new Set(["neutral", "react"]).has(args.proofControl)) {
		throw new Error("--proof-control must be neutral or react");
	}
	const state = {
		server: undefined,
		serverPort: undefined,
		serverLog: { stdout: "", stderr: "" },
		browserProcess: undefined,
		browserPort: undefined,
		browserConnection: undefined,
		browserProfile: undefined,
		graph: undefined,
		semantic: undefined,
		proofControl: undefined,
		observations: undefined,
	};
	const report = {
		schemaVersion: 1,
		host: args.host,
		status: "running",
		marker: args.marker,
		acceptedBase: { head: args.head, tree: args.tree },
		entry: args.entry,
		proofControl: args.proofControl,
		output: slash(args.output),
		base: args.base,
		startedAt: new Date().toISOString(),
		errors: [],
	};
	let failure;
	try {
		if (args.host === "vite") await runVite(args, state);
		else await runNext(args, state);
		report.status = "passed";
	} catch (error) {
		failure = error;
		report.status = "failed";
		report.errors.push(error instanceof Error ? error.message : String(error));
	} finally {
		if (state.browserConnection) {
			try {
				await state.browserConnection.close();
			} catch (error) {
				report.errors.push(`browser connection cleanup: ${String(error)}`);
			}
		}
		const browserCleanup = await terminateOwnedProcess(state.browserProcess);
		const serverCleanup = await terminateOwnedProcess(state.server);
		const serverPortReleased = state.serverPort
			? await confirmPortReleased(state.serverPort)
			: true;
		const browserPortReleased = state.browserPort
			? await confirmPortReleased(state.browserPort)
			: true;
		let profileRemoved = true;
		if (state.browserProfile) {
			try {
				await rm(state.browserProfile, { recursive: true, force: true });
			} catch (error) {
				profileRemoved = false;
				report.errors.push(`browser profile cleanup: ${String(error)}`);
			}
		}
		report.graph = state.graph;
		report.runtime = state.semantic
			? { semantic: state.semantic, proofControl: state.proofControl }
			: undefined;
		report.observations = state.observations;
		report.processes = {
			server: {
				pid: state.server?.pid ?? null,
				port: state.serverPort ?? null,
			},
			browser: {
				pid: state.browserProcess?.pid ?? null,
				port: state.browserPort ?? null,
			},
		};
		report.logs = state.serverLog;
		report.cleanup = {
			server: serverCleanup,
			browser: browserCleanup,
			serverPortReleased,
			browserPortReleased,
			browserProfileRemoved: profileRemoved,
		};
		if (
			!serverCleanup.stopped ||
			!browserCleanup.stopped ||
			!serverPortReleased ||
			!browserPortReleased ||
			!profileRemoved
		) {
			report.status = "failed";
			report.errors.push("owned process/port/profile cleanup was incomplete");
			failure ??= new Error("C7 headless Host cleanup was incomplete");
		}
		report.endedAt = new Date().toISOString();
		if (args.report) {
			await mkdir(dirname(args.report), { recursive: true });
			await writeFile(
				args.report,
				`${JSON.stringify(report, null, 2)}\n`,
				"utf8",
			);
		}
		const serialized = JSON.stringify(report, null, 2);
		if (failure) console.error(serialized);
		else console.log(serialized);
	}
	if (failure) throw failure;
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
