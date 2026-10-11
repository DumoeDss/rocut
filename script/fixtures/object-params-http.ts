import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { startHost } from "../../apps/cli/src/host";
import { TargetRegistry } from "../../apps/cli/src/target-registry";
import { FileProjectStore } from "../../apps/cli/src/file-store";
import { importProgrammaticResource } from "../../apps/cli/src/programmatic/resource-import";
import { particlePoseGlb } from "./particle-input-resources";

const creator =
	"E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/elftia/elftia-plugin-creator-studio/resources/agent/skills/html-video/assets/rocut-stylized";
export async function runObjectParamsHttp(root: string) {
	const projectRoot = join(root, "project"),
		registryRoot = join(root, "registry");
	const host = await startHost({
		projectRoot,
		registry: new TargetRegistry(registryRoot),
		htmlBrowserExecutable: "",
		htmlFrameConnectionFile: "",
	});
	const results: unknown[] = [],
		checks: Record<string, boolean> = {};
	let legacy: ReturnType<typeof spawn> | undefined;
	const snapshot = async (
		directory: string,
	): Promise<Record<string, string>> => {
		const entries: Record<string, string> = {};
		for (const item of await readdir(directory, { withFileTypes: true })) {
			const path = join(directory, item.name);
			if (item.isDirectory())
				for (const [name, hash] of Object.entries(await snapshot(path)))
					entries[`${item.name}/${name}`] = hash;
			else
				entries[item.name] = createHash("sha256")
					.update(await readFile(path))
					.digest("hex");
		}
		return entries;
	};
	const requestAt = async (
		base: string,
		method: string,
		route: string,
		input?: unknown,
	) => {
		const response = await fetch(new URL(`api/${route}`, base), {
			method,
			signal: AbortSignal.timeout(15000),
			...(input === undefined
				? {}
				: {
						headers: { "content-type": "application/json" },
						body: JSON.stringify(input),
					}),
		});
		const raw = await response.text();
		return { status: response.status, raw, body: JSON.parse(raw) };
	};
	const request = async (method: string, route: string, input?: unknown) => {
		const result = await requestAt(host.editorUrl, method, route, input);
		assert.equal(result.status, 200, `HTTP ${result.status}`);
		return result.body;
	};
	try {
		const context = await request("GET", "context");
		assert.deepEqual(
			context.programmaticObjectParams.resolvers.map(
				(item: { available: boolean }) => item.available,
			),
			[true, true, true],
		);
		assert.equal(
			context.programmaticObjectParams.route,
			"programmatic/object-params",
		);
		checks.capability = true;
		const modelFile = join(root, "pose.glb");
		await writeFile(modelFile, particlePoseGlb(), { flag: "wx" });
		const model = (
			await importProgrammaticResource({
				store: new FileProjectStore({ root: projectRoot, schemaVersion: 1 }),
				projectId: context.project.id,
				input: {
					id: "assets/pose.glb",
					kind: "model",
					mimeType: "model/gltf-binary",
					filePath: modelFile,
				},
			})
		).resource;
		const before = await snapshot(projectRoot),
			revision = (await request("GET", "context")).revision;
		const { rocutObjectParamsResolver } = await import(
			pathToFileURL(join(creator, "object-params-resolver.mjs")).href
		);
		for (const object of ["glass", "ink", "liquid"]) {
			const defaults = await request("POST", "programmatic/object-params", {
				object,
				params: { version: 1 },
			});
			assert.equal(defaults.ok, true);
			assert.equal(defaults.params.version, 1);
			const params = {
				...defaults.params,
				...(object === "glass"
					? { roughness: 0.25 }
					: object === "ink"
						? { inkDensity: 0.5 }
						: { amount: 0.25 }),
			};
			const valid = await request("POST", "programmatic/object-params", {
				object,
				params,
			});
			assert.equal(valid.ok, true);
			assert.deepEqual(valid.params, params);
			const invalid = await request("POST", "programmatic/object-params", {
				object,
				params: { version: 1, notARustField: true },
			});
			assert.equal(invalid.ok, false);
			assert.equal(typeof invalid.error.message, "string");
			const resolver = rocutObjectParamsResolver({ object, request });
			assert.deepEqual(
				JSON.parse(await resolver(JSON.stringify({ version: 1 }))),
				defaults,
			);
			assert.deepEqual(
				JSON.parse(
					await resolver(JSON.stringify({ version: 1, notARustField: true })),
				),
				invalid,
			);
			const helpers = await import(
				pathToFileURL(join(creator, `${object}-object.mjs`)).href
			);
			const helper = helpers[`${object}ObjectThree`];
			const value = await helper({
				sourceDirectory: join(root, `author-${object}`),
				model,
				resolveParams: resolver,
				[object]: params,
			});
			assert.deepEqual(value.spec.inputProps[object], params);
			await assert.rejects(
				helper({
					sourceDirectory: root,
					model,
					resolveParams: resolver,
					[object]: { notARustField: true },
				}),
				/reject/i,
			);
			results.push({
				object,
				defaults,
				valid,
				invalid,
				helperParams: value.spec.inputProps[object],
			});
		}
		for (const input of [
			{ object: "unknown", params: { version: 1 } },
			{ object: "glass", params: [] },
			{ object: "ink", params: {}, extra: 1 },
		]) {
			assert.equal(
				(
					await requestAt(
						host.editorUrl,
						"POST",
						"programmatic/object-params",
						input,
					)
				).status,
				400,
			);
		}
		checks.invalidTransport = true;
		const badBase = `http://127.0.0.1:${host.port}/not-the-owned-secret/`;
		const denied = await fetch(
			new URL("api/programmatic/object-params", badBase),
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ object: "glass", params: { version: 1 } }),
				signal: AbortSignal.timeout(15000),
			},
		);
		assert([401, 403, 404].includes(denied.status));
		await denied.text();
		checks.authDenied = true;
		const deniedResolver = rocutObjectParamsResolver({
			object: "glass",
			request: async (method: string, route: string, input: unknown) => {
				const response = await fetch(new URL(`api/${route}`, badBase), {
					method,
					headers: { "content-type": "application/json" },
					body: JSON.stringify(input),
					signal: AbortSignal.timeout(15000),
				});
				await response.text();
				throw Error(`auth HTTP ${response.status}`);
			},
		});
		await assert.rejects(deniedResolver('{"version":1}'), /auth HTTP/);
		checks.callbackAuthNoFallback = true;
		// A real pre-interface packed Host, not a mocked facade, must fail closed.
		const oldRegistry = join(root, "old-registry");
		await mkdir(oldRegistry);
		legacy = spawn(
			process.execPath,
			[
				"C:/tmps/rocut-integrated-private-FxmSkS/runtime/rocut.mjs",
				"host",
				"start",
				join(root, "old-project"),
				"--port",
				"0",
				"--targets-root",
				oldRegistry,
			],
			{
				cwd: root,
				windowsHide: true,
				stdio: ["ignore", "pipe", "pipe"],
				env: {
					...process.env,
					ROCUT_HTML_BROWSER_PATH: "",
					ROCUT_ENGINE_TOOLCHAIN_DIR: "",
					ELFTIA_HTML_FRAME_CONNECTION_FILE: join(root, "old-frame.json"),
				},
			},
		);
		const oldTarget = await new Promise<string>((resolve, reject) => {
			let output = "";
			const timer = setTimeout(
				() => reject(Error("Legacy Host startup timeout")),
				15000,
			);
			legacy!.stderr!.on("data", () => {});
			legacy!.once("exit", () => {
				clearTimeout(timer);
				reject(Error("Legacy Host early exit"));
			});
			legacy!.stdout!.on("data", (chunk) => {
				output = (output + chunk).slice(-10000);
				const match = output.match(/^target (\S+)$/m);
				if (match && /^pid \d+$/m.test(output)) {
					clearTimeout(timer);
					resolve(match[1]);
				}
			});
		});
		const secret = JSON.parse(
				await readFile(
					join(oldRegistry, "targets", `${oldTarget}.json`),
					"utf8",
				),
			),
			oldBase = `http://127.0.0.1:${secret.port}/${secret.token}/`;
		const oldContext = await requestAt(oldBase, "GET", "context");
		assert.equal(oldContext.body.programmaticObjectParams, undefined);
		const oldResolver = rocutObjectParamsResolver({
			object: "glass",
			request: async (method: string, route: string, input: unknown) => {
				const response = await requestAt(oldBase, method, route, input);
				assert.equal(response.status, 200, `legacy HTTP ${response.status}`);
				return response.body;
			},
		});
		await assert.rejects(oldResolver('{"version":1}'));
		checks.legacyNoFallback = true;
		const glass = await import(
			pathToFileURL(join(creator, "glass-object.mjs")).href
		);
		await assert.rejects(
			glass.glassObjectThree({
				sourceDirectory: root,
				model,
				resolveParams: oldResolver,
			}),
		);
		checks.legacyHelperNoFallback = true;
		assert.equal((await request("GET", "context")).revision, revision);
		assert.deepEqual(await snapshot(projectRoot), before);
		checks.recordRevisionAttachmentsUnchanged = true;
		await writeFile(
			join(root, "project-file-pins.json"),
			JSON.stringify(
				{ before, after: await snapshot(projectRoot), revision },
				null,
				2,
			),
			{ flag: "wx" },
		);
		await writeFile(
			join(root, "receipt.json"),
			JSON.stringify(
				{
					ok: true,
					root,
					results,
					checks,
					scope:
						"actual private748c Rust/owned Host auth HTTP/capability/Creator callback/existing helpers; real old packed Host negative; no render/GPU/compile",
				},
				null,
				2,
			),
			{ flag: "wx" },
		);
	} finally {
		await host.close();
		checks.hostClosed = true;
		if (legacy && legacy.exitCode === null) {
			const exited = new Promise<void>((resolve) =>
				legacy!.once("exit", () => resolve()),
			);
			legacy.kill("SIGTERM");
			await exited;
		}
		checks.legacyProcessClosed =
			!legacy || legacy.exitCode !== null || legacy.signalCode !== null;
		await writeFile(
			join(root, "cleanup.json"),
			JSON.stringify(checks, null, 2),
			{ flag: "wx" },
		);
	}
	return { ok: true, checks };
}
