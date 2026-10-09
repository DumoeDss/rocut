import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { isAbsolute, relative, resolve } from "node:path";
import { poll } from "./stylized-fusion-checks.mjs";

export function assertPrivateDirectory(path, label) {
	assert(path && isAbsolute(path), `${label} must be absolute`);
	const contained = relative(resolve("C:/tmps"), resolve(path));
	assert(
		contained && !contained.startsWith("..") && !isAbsolute(contained),
		`${label} must stay inside C:/tmps`,
	);
}

export const previewGeometryPolicy = "complete-integer-canvas-v2";
export const previewViewports = Object.freeze(
	Array.from({ length: 128 }, (_, index) =>
		Object.freeze({ width: 1440, height: 1000 + index }),
	),
);

export function isIntegerPreview(bounds, viewport) {
	return Boolean(
		bounds &&
		["x", "y", "width", "height"].every((key) =>
			Number.isInteger(bounds[key]),
		) &&
		bounds.width >= 630 &&
		bounds.width <= 640 &&
		bounds.height >= 350 &&
		bounds.height <= 360 &&
		bounds.x >= 0 &&
		bounds.y >= 0 &&
		bounds.x + bounds.width <= viewport.width &&
		bounds.y + bounds.height <= viewport.height,
	);
}

export async function selectIntegerPreview(page, canvas) {
	const attempts = [];
	// Fix horizontal geometry; cover fractional vertical split-panel positioning.
	// The finite candidate list is declared before any pixel read or video export.
	for (const viewport of previewViewports) {
		await page.setViewportSize(viewport);
		let previous,
			stable = 0;
		const bounds = await poll(async () => {
			const current = await canvas.boundingBox();
			const encoded = JSON.stringify(current);
			stable = encoded === previous ? stable + 1 : 0;
			previous = encoded;
			return current && stable >= 2 ? current : null;
		}, 5000);
		attempts.push({ viewport, bounds });
		if (isIntegerPreview(bounds, viewport))
			return { policy: previewGeometryPolicy, viewport, bounds, attempts };
	}
	throw Error(`No integer full-canvas geometry: ${JSON.stringify(attempts)}`);
}

export async function deadline(operation, ms, label) {
	let timer;
	try {
		return await Promise.race([
			operation,
			new Promise((_, reject) => {
				timer = setTimeout(
					() => reject(Error(`${label} deadline exceeded`)),
					ms,
				);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

export function hostReadiness(host, diagnostics) {
	return deadline(
		new Promise((done, reject) => {
			let buffer = "";
			host.once("error", reject);
			host.once("exit", (code) =>
				reject(Error(`Droplets Host exited ${code}: ${diagnostics()}`)),
			);
			host.stdout.on("data", (chunk) => {
				buffer += chunk.toString();
				if (buffer.length >= 65536) {
					buffer = "";
					reject(Error("Host readiness output exceeded its bound"));
					return;
				}
				let newline;
				while ((newline = buffer.indexOf("\n")) >= 0) {
					const line = buffer.slice(0, newline);
					buffer = buffer.slice(newline + 1);
					try {
						const message = JSON.parse(line);
						if (message.editorUrl) done(message.editorUrl);
					} catch {
						/* Unrelated local startup diagnostics are not readiness. */
					}
				}
			});
		}),
		60000,
		"Droplets Host startup",
	);
}

async function stopOwnedChild(child, exited) {
	if (!child || child.exitCode !== null || child.signalCode !== null)
		return { closed: true, forced: false };
	child.stdin.end("stop\n");
	try {
		await deadline(exited, 20000, "Droplets Host graceful close");
	} catch {
		assert(
			Number.isInteger(child.pid) && child.pid > 0,
			"Only the spawned Host PID may be terminated",
		);
		const killer = spawn(
			"taskkill.exe",
			["/PID", String(child.pid), "/T", "/F"],
			{ windowsHide: true, stdio: "ignore" },
		);
		await deadline(
			new Promise((done, reject) => {
				killer.once("error", reject);
				killer.once("exit", (code) =>
					code === 0 ? done() : reject(Error(`Owned Host stop failed ${code}`)),
				);
			}),
			10000,
			"Owned Host process cleanup",
		);
		await deadline(exited, 10000, "Owned Host exit");
		return { closed: true, forced: true };
	}
	return { closed: true, forced: false };
}

export async function closeEditorProbe(browser, server, host, exited) {
	const cleanup = { errors: [], browserClosed: false, host: null };
	try {
		await deadline(
			browser?.close() ?? Promise.resolve(),
			15000,
			"Browser close",
		);
		await deadline(
			server?.close() ?? Promise.resolve(),
			15000,
			"Owned Chromium close",
		);
		cleanup.browserClosed = true;
	} catch (error) {
		cleanup.errors.push(String(error));
		try {
			await deadline(
				server?.kill() ?? Promise.resolve(),
				10000,
				"Owned Chromium force close",
			);
		} catch (failure) {
			cleanup.errors.push(String(failure));
		}
	}
	try {
		cleanup.host = await stopOwnedChild(host, exited);
	} catch (error) {
		cleanup.errors.push(String(error));
	}
	return cleanup;
}
