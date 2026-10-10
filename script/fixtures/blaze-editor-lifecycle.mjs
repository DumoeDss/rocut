import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { isAbsolute } from "node:path";

export const blazeEditorRedact = (text) =>
	String(text).replace(/https?:\/\/[^\s"'<>]+/g, "[private URL redacted]");

export async function blazeEditorDeadline(promise, timeout, label) {
	let timer;
	try {
		return await Promise.race([
			promise,
			new Promise((_, reject) => {
				timer = setTimeout(
					() => reject(Error(`${label} deadline exceeded`)),
					timeout,
				);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

export function launchBlazeEditorHost({ snapshot, root, configPath, env }) {
	const command = process.env.OPENCUT_BUN;
	assert(
		command && isAbsolute(command),
		"Set OPENCUT_BUN to an explicit Bun executable for the private Host",
	);
	const args = ["script/fixtures/blaze-editor-host.ts", root, configPath];
	const child = spawn(command, args, {
		cwd: snapshot,
		windowsHide: true,
		stdio: ["pipe", "pipe", "pipe"],
		env,
	});
	let stdout = "",
		stderr = "",
		lines = "";
	const closed = new Promise((done, reject) => {
		child.once("error", reject);
		child.once("close", (code, signal) => done({ code, signal }));
	});
	const ready = new Promise((done, reject) => {
		child.once("error", reject);
		child.once("close", (code) =>
			reject(Error(`Private Blaze Host closed before readiness: ${code}`)),
		);
		child.stdout.on("data", (bytes) => {
			const text = bytes.toString();
			stdout += text;
			lines += text;
			if (lines.length >= 131072) {
				reject(Error("Host readiness line exceeded its bound"));
				return;
			}
			let newline;
			while ((newline = lines.indexOf("\n")) >= 0) {
				const line = lines.slice(0, newline);
				lines = lines.slice(newline + 1);
				try {
					const value = JSON.parse(line);
					if (value.editorUrl) done(value.editorUrl);
				} catch {
					/* Other Host diagnostics are not readiness. */
				}
			}
		});
	});
	child.stderr.on("data", (bytes) => {
		stderr += bytes.toString();
	});
	child.stdin.on("error", (error) => {
		stderr += error.message;
	});
	return {
		child,
		ready: blazeEditorDeadline(ready, 60000, "Blaze Host startup"),
		closed,
		command,
		args,
		logs: () => ({
			stdout: blazeEditorRedact(stdout),
			stderr: blazeEditorRedact(stderr),
		}),
	};
}

export async function closeBlazeEditorResources({
	browser,
	server,
	host,
	verify,
}) {
	const result = {
		browserClosed: false,
		hostClosed: false,
		forced: false,
		errors: [],
	};
	try {
		await blazeEditorDeadline(
			browser?.close() ?? Promise.resolve(),
			15000,
			"Browser close",
		);
		await blazeEditorDeadline(
			server?.close() ?? Promise.resolve(),
			15000,
			"Private Chromium close",
		);
		result.browserClosed = true;
	} catch (error) {
		result.errors.push(blazeEditorRedact(error));
		try {
			await server?.kill();
		} catch (failure) {
			result.errors.push(blazeEditorRedact(failure));
		}
	}
	if (host) {
		try {
			if (host.child.exitCode === null && host.child.signalCode === null)
				host.child.stdin.end(verify ? "verify\n" : "stop\n");
			const closed = await blazeEditorDeadline(
				host.closed,
				25000,
				"Blaze Host close and persistence reopen",
			);
			assert.equal(closed.code, 0, "Private Host failed its final checks");
			result.hostClosed = true;
		} catch (error) {
			result.errors.push(blazeEditorRedact(error));
			if (host.child.exitCode === null && host.child.signalCode === null) {
				result.forced = true;
				host.child.kill();
				try {
					await blazeEditorDeadline(
						host.closed,
						10000,
						"Owned Host forced close",
					);
				} catch (failure) {
					result.errors.push(blazeEditorRedact(failure));
				}
			}
		}
	}
	return result;
}
