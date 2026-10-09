import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "../browser-probe-toolchain.mjs";
import { verifyExportTimingEditor } from "./hyperframes-export-timing-editor-verify.mjs";
const hash = async (path) =>
	createHash("sha256")
		.update(await readFile(path))
		.digest("hex");
const writeJson = (directory, name, value) =>
	writeFile(join(directory, name), JSON.stringify(value, null, 2), {
		flag: "wx",
	});

export async function runExportTimingEditorCase({
	test,
	directory,
	output,
	root,
	toolchain,
	ffmpeg,
	ffprobe,
	browser,
}) {
	const host = spawn(
		"bun",
		[
			"--preload",
			"./script/fixtures/isolated-web-wasm-preload.mjs",
			"script/fixtures/hyperframes-export-timing-editor-host.ts",
			toolchain,
			directory,
			test.id,
		],
		{
			cwd: root,
			windowsHide: true,
			stdio: ["pipe", "pipe", "pipe"],
			env: {
				...process.env,
				TEMP: directory,
				TMP: directory,
				TMPDIR: directory,
			},
		},
	);
	const exited = new Promise((done) => host.once("close", done));
	let ready = false,
		server,
		page;
	try {
		const endpoint = await new Promise((done, reject) => {
			let output = "";
			const timer = setTimeout(
				() => reject(Error("Explicit timing Host startup timeout")),
				120000,
			);
			const fail = (error) => {
				clearTimeout(timer);
				reject(error);
			};
			host.once("error", fail);
			host.once("exit", (code) =>
				fail(Error("Explicit timing Host exited " + code)),
			);
			host.stderr.on("data", (data) => {
				appendFileSync(join(directory, "host.stderr.log"), data);
				process.stderr.write(data);
			});
			host.stdout.on("data", (data) => {
				appendFileSync(join(directory, "host.stdout.log"), data);
				process.stdout.write(data);
				output += String(data);
				let end;
				while ((end = output.indexOf("\n")) >= 0) {
					const line = output.slice(0, end);
					output = output.slice(end + 1);
					try {
						const value = JSON.parse(line);
						if (value.endpoint) {
							clearTimeout(timer);
							done(value.endpoint);
						}
					} catch {
						/* Non-JSON progress is retained in the raw log. */
					}
				}
			});
		});
		ready = true;
		server = await createServer({
			root: output,
			configFile: false,
			cacheDir: join(directory, "vite-cache"),
			logLevel: "error",
			optimizeDeps: { noDiscovery: true, include: [] },
			server: {
				host: "127.0.0.1",
				hmr: false,
				port: 0,
				proxy: { "/api": { target: endpoint } },
			},
		});
		await server.listen();
		page = await browser.newPage();
		const errors = [];
		page.on("pageerror", (e) => errors.push(e.message));
		page.on("console", (m) => {
			if (m.type() === "error") errors.push(m.text().slice(0, 2000));
		});
		await page.goto(
			`http://127.0.0.1:${server.httpServer.address().port}/script/fixtures/hyperframes-export-timing-editor-browser.html`,
			{ waitUntil: "commit", timeout: 90000 },
		);
		await page
			.waitForFunction(
				() => globalThis.__hyperframesExportTimingEditor,
				undefined,
				{ timeout: 180000 },
			)
			.catch((error) => {
				throw Error(JSON.stringify({ error: String(error), errors }));
			});
		const result = await page.evaluate(
			() => globalThis.__hyperframesExportTimingEditor,
		);
		await writeJson(directory, "browser-result.json", { result, errors });
		if (result.error || errors.length)
			throw Error(
				JSON.stringify({
					error: result.error,
					errors,
					requests: result.requests,
				}),
			);
		assert.deepEqual(result.requests, { audio: 1, identity: 4 });
		const counts = await (await fetch(`${endpoint}/api/counts`)).json();
		assert.deepEqual(counts, {
			identityRequests: 4,
			audioRequests: 1,
			pictureRequests: test.encode ? 25 : 0,
		});
		const { bytes, pcm, rawPcm, partialPcm, ...metrics } = result;
		const mixedPcm = Buffer.from(pcm);
		for (const [name, pcm] of [
			["mixed", mixedPcm],
			["native-graph", Buffer.from(rawPcm)],
			["partial", Buffer.from(partialPcm)],
		])
			await writeFile(join(directory, `${name}.f32le`), pcm, { flag: "wx" });
		let decoded = null,
			videoSha256 = null;
		if (test.encode) {
			const file = join(directory, "hyperframes-export-timing-editor.webm");
			await writeFile(file, Buffer.from(bytes), { flag: "wx" });
			decoded = verifyExportTimingEditor({
				file,
				ffmpeg,
				ffprobe,
				artifact: directory,
				mixedPcm,
			});
			videoSha256 = await hash(file);
		} else assert.equal(bytes.length, 0);
		const report = {
			...metrics,
			id: test.id,
			encoded: test.encode,
			videoSha256,
			exportedBytes: bytes.length,
			counts,
			oracle: JSON.parse(
				await readFile(join(directory, "host/oracle.json"), "utf8"),
			),
			decoded,
		};
		await writeJson(directory, "verification.json", report);
		return report;
	} finally {
		await page?.close();
		await server?.close();
		if (host.exitCode === null && !host.killed) {
			if (ready) host.stdin.end("stop\n");
			else host.kill();
		}
		await exited;
	}
}
