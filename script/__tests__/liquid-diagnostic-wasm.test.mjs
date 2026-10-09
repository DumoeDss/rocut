import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import test from "node:test";
import { liquidDiagnosticWasmRoute } from "../liquid-diagnostic-wasm.mjs";

const artifactRoot = process.env.ROCUT_LIQUID_ROUTE_TEST_ROOT;

test(
	"diagnostic WASM middleware serves only its captured binary URL",
	{
		skip: !artifactRoot ? "Set explicit ROCUT_LIQUID_ROUTE_TEST_ROOT" : false,
	},
	async (t) => {
		assert.ok(isAbsolute(artifactRoot));
		const directory = await mkdtemp(join(artifactRoot, "liquid-route-"));
		t.diagnostic(`Retained artifacts: ${directory}`);
		const filename = join(directory, "opencut_wasm_bg.wasm");
		const initial = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
		await writeFile(filename, initial, { flag: "wx" });
		const plugin = await liquidDiagnosticWasmRoute(directory);
		let handler;
		plugin.configureServer({
			middlewares: {
				use(value) {
					assert.equal(handler, undefined);
					handler = value;
				},
			},
		});
		assert.equal(typeof handler, "function");
		const url = `/@fs/${filename.replaceAll("\\", "/")}`;
		function request(overrides = {}) {
			const result = { next: 0, ends: 0, headers: {}, body: undefined };
			handler(
				{ method: "GET", url, ...overrides },
				{
					setHeader(name, value) {
						result.headers[name] = value;
					},
					end(body) {
						result.ends++;
						result.body = body;
					},
				},
				() => result.next++,
			);
			return result;
		}
		const headers = {
			"Content-Type": "application/wasm",
			"Content-Length": initial.length,
			"Cache-Control": "no-store",
		};
		await t.test(
			"GET serves the exact byte snapshot and binary headers",
			() => {
				assert.deepEqual(request(), {
					next: 0,
					ends: 1,
					headers,
					body: initial,
				});
			},
		);
		await t.test("HEAD has the same length without a response body", () => {
			assert.deepEqual(request({ method: "HEAD" }), {
				next: 0,
				ends: 1,
				headers,
				body: undefined,
			});
		});
		await t.test(
			"originalUrl retains query-bearing Vite module routing",
			() => {
				for (const suffix of ["?import", "?import&url", "?raw", "?x=1"])
					assert.deepEqual(request({ originalUrl: url + suffix }), {
						next: 1,
						ends: 0,
						headers: {},
						body: undefined,
					});
				assert.deepEqual(request({ originalUrl: url, url: "/rewritten" }), {
					next: 0,
					ends: 1,
					headers,
					body: initial,
				});
			},
		);
		await t.test("other methods and paths pass through without headers", () => {
			const cases = [
				{ method: "POST" },
				{ method: "OPTIONS" },
				{ method: undefined },
				{ url: url + ".js" },
				{ url: url + "?import" },
				{ url: url + "/../secret" },
				{ url: "/@fs/C:/unrelated/opencut_wasm_bg.wasm" },
				{ originalUrl: "" },
			];
			for (const item of cases)
				assert.deepEqual(request(item), {
					next: 1,
					ends: 0,
					headers: {},
					body: undefined,
				});
		});
		await t.test(
			"requests do not re-read a subsequently changed file",
			async () => {
				await writeFile(filename, Buffer.from("changed test fixture"));
				assert.deepEqual(request().body, initial);
			},
		);
	},
);
