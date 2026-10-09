import { appendFileSync } from "node:fs";
import { readdir, lstat, readFile, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve, isAbsolute } from "node:path";

/** Read-only reuse of a previously built private client; the host/store are fresh.
 * Record every executable asset and require the same genuine WASM bytes.
 */
export async function inspectReusableWeb(artifact, wasmSha256) {
	if (!isAbsolute(artifact)) throw Error("Reusable artifact must be absolute");
	const root = resolve(artifact, "web");
	const actual = await realpath(root);
	const canonical = (path) =>
		process.platform === "win32" ? path.toLowerCase() : path;
	if (canonical(actual) !== canonical(root))
		throw Error("Reusable web path is redirected");
	const prepared = JSON.parse(
		await readFile(join(artifact, "prepared.json"), "utf8"),
	);
	if (
		prepared.wasmSha256 !== wasmSha256 ||
		prepared.frames !== 150 ||
		prepared.durationSeconds !== 6
	)
		throw Error("Reusable client is not this six-second fixture/WASM");
	const files = [];
	async function walk(directory, prefix = "") {
		for (const name of (await readdir(directory)).sort()) {
			const path = join(directory, name),
				info = await lstat(path);
			if (info.isSymbolicLink())
				throw Error("Reusable client contains a redirected asset");
			const relative = prefix + name;
			if (info.isDirectory()) await walk(path, relative + "/");
			else
				files.push({
					path: relative,
					bytes: info.size,
					sha256: createHash("sha256")
						.update(await readFile(path))
						.digest("hex"),
				});
		}
	}
	await walk(root);
	const wasm = files.filter((file) => file.path.endsWith(".wasm"));
	if (
		wasm.length !== 1 ||
		wasm[0].sha256 !== wasmSha256 ||
		!files.some(
			(file) => file.path === "script/fixtures/multishot-mv-browser.html",
		)
	)
		throw Error("Reusable client assets/WASM do not match");
	return {
		root,
		artifact,
		files,
		manifestSha256: createHash("sha256")
			.update(JSON.stringify(files))
			.digest("hex"),
	};
}

export async function artifactBudget(directory) {
	let bytes = 0;
	async function walk(root) {
		for (const name of await readdir(root)) {
			const path = join(root, name),
				info = await lstat(path);
			if (info.isSymbolicLink())
				throw Error("Unexpected redirected artifact path");
			if (info.isDirectory()) await walk(path);
			else bytes += info.size;
		}
	}
	await walk(directory);
	if (bytes > 200 * 1024 * 1024)
		throw Error(`Private artifact budget exceeded: ${bytes}`);
	return bytes;
}

export function readyEndpoint(host, artifact) {
	return new Promise((resolve, reject) => {
		let output = "";
		const timer = setTimeout(
			() => reject(Error("Private compile/archive startup timeout")),
			180000,
		);
		const fail = (error) => {
			clearTimeout(timer);
			reject(error);
		};
		host.once("error", fail);
		host.once("exit", (code) => fail(Error(`Private fixture exited ${code}`)));
		host.stderr.on("data", (data) => {
			appendFileSync(join(artifact, "host.stderr.log"), data);
			process.stderr.write(data);
		});
		host.stdout.on("data", (data) => {
			appendFileSync(join(artifact, "host.stdout.log"), data);
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
						resolve(value.endpoint);
					}
				} catch {}
			}
		});
	});
}
